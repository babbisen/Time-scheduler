const { DateTime, Interval } = luxon;
const TIMEZONE = 'Europe/Brussels';
const appEl = document.getElementById('app');

let state = {
  authed: false,
  loading: false,
  error: '',
  currentActor: null,
  weekStart: DateTime.now().setZone(TIMEZONE).startOf('week'),
  data: null,
  history: [],
  modal: null
};

function setState(patch) {
  state = { ...state, ...patch };
  render();
}

function fmtDateRange(startIso, endIso) {
  const start = DateTime.fromISO(startIso, { zone: TIMEZONE });
  const end = DateTime.fromISO(endIso, { zone: TIMEZONE });
  return `${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}`;
}

function fmtDurationHours(hours) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function afterHoursOverlap(block) {
  const start = DateTime.fromISO(block.start, { zone: TIMEZONE });
  const end = DateTime.fromISO(block.end, { zone: TIMEZONE });
  const afterStart = start.startOf('day').set({ hour: 17 });
  const afterEnd = start.startOf('day').plus({ days: 1 }).set({ hour: 1 });
  return Interval.fromDateTimes(start, end).overlaps(Interval.fromDateTimes(afterStart, afterEnd));
}

async function api(path, options = {}) {
  try {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Request failed');
    }
    return await res.json();
  } catch (err) {
    throw err;
  }
}

async function login(password) {
  setState({ loading: true, error: '' });
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) });
    const weekStart = DateTime.now().setZone(TIMEZONE).startOf('week');
    await loadWeek(weekStart);
    setState({ authed: true, currentActor: state.data.persons[0].id, loading: false });
  } catch (err) {
    setState({ error: err.message, loading: false });
  }
}

async function loadWeek(weekStart) {
  const iso = weekStart.toISODate();
  setState({ loading: true, error: '' });
  try {
    const data = await api(`/api/week?start=${iso}`);
    const history = await api('/api/history?limit=3');
    setState({ data, weekStart, history, loading: false, currentActor: state.currentActor || data.persons[0].id });
  } catch (err) {
    setState({ error: err.message, loading: false });
  }
}

async function saveBlock(block, isEdit = false) {
  const actorHeader = state.currentActor ? { 'x-actor': state.currentActor } : {};
  setState({ loading: true, error: '' });
  try {
    let data;
    if (isEdit) {
      data = await api(`/api/blocks/${block.id}`, { method: 'PATCH', body: JSON.stringify(block), headers: actorHeader });
    } else {
      data = await api('/api/blocks', { method: 'POST', body: JSON.stringify(block), headers: actorHeader });
    }
    const history = await api('/api/history?limit=3');
    setState({ data, history, modal: null, loading: false });
  } catch (err) {
    setState({ error: err.message, loading: false });
  }
}

async function deleteBlock(block) {
  const actorHeader = state.currentActor ? { 'x-actor': state.currentActor } : {};
  setState({ loading: true, error: '' });
  try {
    const data = await api(`/api/blocks/${block.id}`, { method: 'DELETE', headers: actorHeader });
    const history = await api('/api/history?limit=3');
    setState({ data, history, modal: null, loading: false });
  } catch (err) {
    setState({ error: err.message, loading: false });
  }
}

function showModal(day, block = null) {
  setState({ modal: { day, block } });
}

function closeModal() {
  setState({ modal: null, error: '' });
}

function renderLogin() {
  appEl.innerHTML = `
    <div class="card login-card">
      <h2>Time Scheduler Access</h2>
      <p class="footer-note">Shared URL, no password required. Enter to continue.</p>
      <form id="login-form">
        <button class="primary" type="submit">Enter</button>
        ${state.error ? `<div class="error">${state.error}</div>` : ''}
      </form>
    </div>
  `;

  document.getElementById('login-form').addEventListener('submit', (e) => {
    e.preventDefault();
    login('');
  });
}

function dayStatus(summary) {
  if (summary.total === 0) return { text: 'No hours yet', cls: 'status-warning' };
  if (summary.total > 8 || summary.early > 4) return { text: 'Quota exceeded', cls: 'status-error' };
  if (summary.total === 8 && summary.after >= 4) return { text: 'Complete', cls: 'status-complete' };
  if (summary.total === 8 && summary.after < 4) return { text: `Missing ${Number((4 - summary.after).toFixed(2))}h after 17:00`, cls: 'status-warning' };
  return { text: `Missing ${Number((8 - summary.total).toFixed(2))}h`, cls: 'status-warning' };
}

function renderHeader() {
  const weekStart = state.weekStart;
  const weekEnd = weekStart.plus({ days: 4 });
  const weekLabel = `${weekStart.toFormat('dd LLL')}–${weekEnd.toFormat('dd LLL yyyy')}`;
  const weekNumber = weekStart.toFormat('WW');
  return `
    <div class="header card">
      <div class="week-selector">
        <button data-nav="prev">◀ Previous week</button>
        <button data-nav="today">This week</button>
        <button data-nav="next">Next week ▶</button>
      </div>
      <div><strong>Week ${weekNumber}</strong> (${weekLabel})</div>
      <div class="identity">
        ${state.data.persons.map((p) => `<button data-person="${p.id}" class="${state.currentActor === p.id ? 'active' : ''}">${p.name}</button>`).join('')}
      </div>
    </div>
  `;
}

function renderDayColumn(day, summary, blocks) {
  const dayLabel = day.toFormat('cccc');
  const dayDate = day.toFormat('dd LLL');
  const dayKey = day.toISODate();
  const dayBlocks = blocks.filter((b) => DateTime.fromISO(b.start, { zone: TIMEZONE }).toISODate() === dayKey)
    .sort((a, b) => DateTime.fromISO(a.start) - DateTime.fromISO(b.start));
  const status = dayStatus(summary);
  return `
    <div class="day-row" data-day="${dayKey}">
      <div class="day-info">
        <div class="day-title">
          <span class="day-name">${dayLabel}</span>
          <span class="day-date">${dayDate}</span>
        </div>
        <div class="day-total">Total ${summary.total.toFixed(1)} / 8h</div>
        <div class="day-status ${status.cls}">${status.text}</div>
      </div>
      <div class="day-body">
        <div class="day-blocks">
          ${dayBlocks.map((b) => {
            const person = state.data.persons.find((p) => p.id === b.personId);
            const allowEdit = b.personId === state.currentActor;
            return `
              <div class="block-card" data-block="${b.id}" style="border-left: 5px solid ${person.color}; opacity: ${allowEdit ? 1 : 0.6}">
                <div class="block-meta">
                  <strong>${person.name}</strong>
                  <span>${fmtDateRange(b.start, b.end)}</span>
                </div>
                <div class="block-meta">
                  <span>${fmtDurationHours(durationHours(b))}</span>
                  ${afterHoursOverlap(b) ? '<span class="badge">After-hours</span>' : ''}
                </div>
                ${allowEdit ? '<span class="edit-hint" aria-hidden="true">✎ Edit</span>' : ''}
              </div>
            `;
          }).join('') || '<div class="footer-note">No blocks yet</div>'}
        </div>
        <div class="day-summary">
          <span>Early ${summary.early.toFixed(1)}h</span>
          <span>After ${summary.after.toFixed(1)}h</span>
        </div>
      </div>
    </div>
  `;
}

function durationHours(block) {
  const start = DateTime.fromISO(block.start);
  const end = DateTime.fromISO(block.end);
  return Number(end.diff(start, 'hours').hours.toFixed(2));
}

function renderWeekGrid() {
  const columns = [];
  for (let i = 0; i < 5; i++) {
    const day = state.weekStart.plus({ days: i });
    const key = day.toISODate();
    columns.push(renderDayColumn(day, state.data.daySummaries[key], state.data.blocks));
  }
  return `<div class="week-grid">${columns.join('')}</div>`;
}

function renderSummarySidebar() {
  const personTotals = state.data.personSummaries;
  return `
    <div class="side-panel">
      <div class="card weekly-panel">
        <h3>Weekly totals</h3>
        ${state.data.persons.map((p) => {
          const hours = personTotals[p.id] || 0;
          const pct = Math.round((hours / 40) * 100);
          return `
            <div class="person-summary">
              <div class="person-summary__header">
                <span>${p.name}</span>
                <span>${hours.toFixed(1)}h (${pct}%)</span>
              </div>
              <div class="progress">
                <span style="width: ${Math.min(pct, 100)}%"></span>
              </div>
            </div>
          `;
        }).join('')}
        <div class="week-total">
          <span>Week total</span>
          <strong>${state.data.weekTotal.toFixed(1)} / 40h</strong>
        </div>
      </div>
      <div class="card history">
        <h3>Recent changes</h3>
        ${state.history.length === 0 ? '<div class="footer-note">Nothing yet</div>' : state.history.map((h) => {
          const actor = state.data.persons.find((p) => p.id === h.actorPersonId);
          const stamp = DateTime.fromISO(h.timestamp, { zone: TIMEZONE }).toFormat('ccc HH:mm');
          return `<div class="footer-note">${stamp} — ${actor?.name || 'Unknown'}: ${h.details}</div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function renderModal() {
  if (!state.modal) return '';
  const { day, block } = state.modal;
  const dayDt = DateTime.fromISO(day, { zone: TIMEZONE });
  const startDefault = block ? DateTime.fromISO(block.start, { zone: TIMEZONE }) : dayDt.set({ hour: 9, minute: 0 });
  const endDefault = block ? DateTime.fromISO(block.end, { zone: TIMEZONE }) : dayDt.set({ hour: 17, minute: 0 });
  const title = block ? 'Edit block' : `Add block for ${dayDt.toFormat('ccc dd LLL')}`;
  const quickPresets = [
    { label: '13:00–17:00', start: dayDt.set({ hour: 13 }), end: dayDt.set({ hour: 17 }) },
    { label: '17:00–21:00', start: dayDt.set({ hour: 17 }), end: dayDt.set({ hour: 21 }) },
    { label: '18:00–22:00', start: dayDt.set({ hour: 18 }), end: dayDt.set({ hour: 22 }) },
  ];
  return `
    <div class="modal-backdrop">
      <div class="modal card">
        <h3>${title}</h3>
        <form id="block-form">
          <label>Start</label>
          <input type="datetime-local" name="start" value="${startDefault.toFormat("yyyy-LL-dd'T'HH:mm")}" required />
          <label>End</label>
          <input type="datetime-local" name="end" value="${endDefault.toFormat("yyyy-LL-dd'T'HH:mm")}" required />
          <div class="footer-note">Will apply to ${state.currentActor}</div>
          ${state.error ? `<div class="error">${state.error}</div>` : ''}
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            ${quickPresets.map((p) => `<button type="button" class="secondary" data-preset-start="${p.start.toISO()}" data-preset-end="${p.end.toISO()}">${p.label}</button>`).join('')}
          </div>
          <div style="display:flex; gap:8px; justify-content:flex-end;">
            ${block ? '<button type="button" class="secondary" id="delete-block">Delete</button>' : ''}
            <button type="button" class="secondary" id="cancel-modal">Cancel</button>
            <button class="primary" type="submit">Save</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderApp() {
  const content = `
    ${renderHeader()}
    <div class="main-grid">
      <div>
        ${renderWeekGrid()}
      </div>
      ${renderSummarySidebar()}
    </div>
    ${renderModal()}
  `;
  appEl.innerHTML = content;

  document.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const type = btn.getAttribute('data-nav');
      if (type === 'prev') loadWeek(state.weekStart.minus({ weeks: 1 }));
      if (type === 'next') loadWeek(state.weekStart.plus({ weeks: 1 }));
      if (type === 'today') loadWeek(DateTime.now().setZone(TIMEZONE).startOf('week'));
    });
  });

  document.querySelectorAll('.identity button').forEach((btn) => {
    btn.addEventListener('click', () => setState({ currentActor: btn.getAttribute('data-person') }));
  });

  document.querySelectorAll('.day-row').forEach((col) => {
    col.addEventListener('click', (e) => {
      const blockId = e.target.closest?.('.block-card')?.getAttribute('data-block');
      const day = col.getAttribute('data-day');
      if (blockId) {
        const block = state.data.blocks.find((b) => b.id === blockId);
        if (block.personId === state.currentActor) {
          showModal(day, block);
        }
      } else {
        showModal(day, null);
      }
    });
  });

  const modalEl = document.querySelector('.modal-backdrop');
  if (modalEl) {
    const form = document.getElementById('block-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const start = DateTime.fromISO(form.start.value, { zone: TIMEZONE }).toISO();
      const end = DateTime.fromISO(form.end.value, { zone: TIMEZONE }).toISO();
      const payload = { personId: state.currentActor, start, end };
      if (state.modal.block) payload.id = state.modal.block.id;
      saveBlock(payload, Boolean(state.modal.block));
    });

    form.querySelectorAll('button[data-preset-start]').forEach((btn) => {
      btn.addEventListener('click', () => {
        form.start.value = DateTime.fromISO(btn.getAttribute('data-preset-start')).toFormat("yyyy-LL-dd'T'HH:mm");
        form.end.value = DateTime.fromISO(btn.getAttribute('data-preset-end')).toFormat("yyyy-LL-dd'T'HH:mm");
      });
    });

    document.getElementById('cancel-modal').addEventListener('click', closeModal);
    const delBtn = document.getElementById('delete-block');
    if (delBtn) {
      delBtn.addEventListener('click', () => deleteBlock(state.modal.block));
    }
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });
  }
}

function render() {
  if (!state.authed) {
    renderLogin();
    return;
  }
  if (!state.data) return;
  renderApp();
}

render();

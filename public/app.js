const { DateTime } = luxon;
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
  modal: null,
  darkMode: false
};

state.darkMode = loadTheme();
applyTheme(state.darkMode);

function setState(patch) {
  state = { ...state, ...patch };
  render();
}

function applyTheme(isDark) {
  document.body.classList.toggle('dark', isDark);
  try {
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  } catch (err) {
    // ignore
  }
}

function loadTheme() {
  try {
    return localStorage.getItem('theme') === 'dark';
  } catch (err) {
    return false;
  }
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

function getDaySummary(dayIso) {
  return state.data?.daySummaries?.[dayIso] || { total: 0 };
}

function isWeekend(dayIso) {
  const day = DateTime.fromISO(dayIso, { zone: TIMEZONE });
  return day.weekday === 6 || day.weekday === 7;
}

function getWeekendTotal() {
  if (!state.data?.daySummaries || !state.weekStart) return 0;
  const saturday = state.weekStart.plus({ days: 5 }).toISODate();
  const sunday = state.weekStart.plus({ days: 6 }).toISODate();
  return (state.data.daySummaries[saturday]?.total || 0) + (state.data.daySummaries[sunday]?.total || 0);
}

function getTargetHours(dayIso) {
  if (isWeekend(dayIso)) {
    return { target: 5, label: 'weekend' };
  }
  return { target: 8, label: 'day' };
}

function computeRemainingHours(dayIso, startIso, endIso, blockId) {
  const summary = getDaySummary(dayIso);
  const start = DateTime.fromISO(startIso, { zone: TIMEZONE });
  const end = DateTime.fromISO(endIso, { zone: TIMEZONE });
  const duration = Math.max(0, end.diff(start, 'minutes').minutes / 60);
  const existing = state.data?.blocks?.find((b) => b.id === blockId);
  const existingHours = existing ? durationHours(existing) : 0;
  const { target, label } = getTargetHours(dayIso);
  const baseTotal = isWeekend(dayIso) ? getWeekendTotal() : summary.total;
  const projected = baseTotal - existingHours + duration;
  const remaining = Math.max(0, target - projected);
  return { remaining, projected, target, label };
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

function dayStatus(summary, dayIso) {
  const { target, label } = getTargetHours(dayIso);
  const total = isWeekend(dayIso) ? getWeekendTotal() : summary.total;
  if (total === 0) return { text: label === 'weekend' ? 'No weekend hours yet' : 'No hours yet', cls: 'status-warning' };
  if (total > target) return { text: `Over ${target}h logged`, cls: 'status-error' };
  if (total === target) return { text: 'Complete', cls: 'status-complete' };
  return { text: `Missing ${Number((target - total).toFixed(2))}h`, cls: 'status-warning' };
}

function renderHeader() {
  const weekStart = state.weekStart;
  const weekEnd = weekStart.plus({ days: 6 });
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
        <button class="theme-toggle" type="button" data-theme-toggle>${state.darkMode ? 'Light mode' : 'Dark mode'}</button>
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
  const status = dayStatus(summary, dayKey);
  const dayTotal = isWeekend(dayKey) ? getWeekendTotal() : summary.total;
  const label = isWeekend(dayKey) ? 'Weekend total' : 'Total';
  const target = isWeekend(dayKey) ? 5 : 8;
  return `
    <div class="day-row" data-day="${dayKey}">
      <div class="day-info">
        <div class="day-title">
          <span class="day-name">${dayLabel}</span>
          <span class="day-date">${dayDate}</span>
        </div>
        <div class="day-total">${label} ${dayTotal.toFixed(1)} / ${target}h</div>
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
                </div>
                ${allowEdit ? '<span class="edit-hint" aria-hidden="true">✎ Edit</span>' : ''}
              </div>
            `;
          }).join('') || '<div class="footer-note">No blocks yet</div>'}
        </div>
        <div class="day-summary">
          <span>${summary.total.toFixed(1)}h logged</span>
          <span>${status.text}</span>
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
  for (let i = 0; i < 7; i++) {
    const day = state.weekStart.plus({ days: i });
    const key = day.toISODate();
    columns.push(renderDayColumn(day, state.data.daySummaries[key], state.data.blocks));
  }
  return `<div class="week-grid">${columns.join('')}</div>`;
}

function renderSummarySidebar() {
  const personTotals = state.data.personSummaries;
  const weeklyEarnings = state.data.weekTotal * 15;
  return `
    <div class="side-panel">
      <div class="card weekly-panel">
        <h3>Weekly totals</h3>
        ${state.data.persons.map((p) => {
          const hours = personTotals[p.id] || 0;
          const pct = Math.round((hours / 40) * 100);
          const earnings = hours * 15;
          return `
            <div class="person-summary">
              <div class="person-summary__header">
                <span>${p.name}</span>
                <span>${hours.toFixed(1)}h (${pct}%)</span>
              </div>
              <div class="progress">
                <span style="width: ${Math.min(pct, 100)}%"></span>
              </div>
              <div class="person-earnings">$${earnings.toFixed(2)} earned</div>
            </div>
          `;
        }).join('')}
        <div class="week-total">
          <span>Week total</span>
          <strong>${state.data.weekTotal.toFixed(1)} / 40h</strong>
        </div>
        <div class="week-total earnings">
          <span>Weekly earnings</span>
          <strong>$${weeklyEarnings.toFixed(2)}</strong>
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
  const actorName = state.data.persons.find((p) => p.id === state.currentActor)?.name || state.currentActor;
  const remainingInfo = computeRemainingHours(
    day,
    startDefault.toISO(),
    endDefault.toISO(),
    block?.id
  );
  const remainingLabel = remainingInfo.label === 'weekend' ? 'to reach 5h this weekend' : 'to reach 8h today';
  return `
    <div class="modal-backdrop">
      <div class="modal card">
        <h3>${title}</h3>
        <form id="block-form">
          <label>Start time</label>
          <input type="time" name="start" value="${startDefault.toFormat('HH:mm')}" required />
          <label>End time</label>
          <input type="time" name="end" value="${endDefault.toFormat('HH:mm')}" required />
          <div class="footer-note">Will apply to ${actorName}</div>
          <div class="remaining-hours" id="remaining-hours">
            ${fmtDurationHours(remainingInfo.remaining)} left ${remainingLabel}
          </div>
          ${state.error ? `<div class="error">${state.error}</div>` : ''}
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

  document.querySelectorAll('.identity [data-person]').forEach((btn) => {
    btn.addEventListener('click', () => setState({ currentActor: btn.getAttribute('data-person') }));
  });

  const themeToggle = document.querySelector('[data-theme-toggle]');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const next = !state.darkMode;
      applyTheme(next);
      setState({ darkMode: next });
    });
  }

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
    const remainingEl = document.getElementById('remaining-hours');

    const updateRemaining = () => {
      const day = DateTime.fromISO(state.modal.day, { zone: TIMEZONE });
      const [startHour, startMinute] = form.start.value.split(':').map(Number);
      const [endHour, endMinute] = form.end.value.split(':').map(Number);
      const start = day.set({ hour: startHour, minute: startMinute }).toISO();
      const end = day.set({ hour: endHour, minute: endMinute }).toISO();
      const remainingInfo = computeRemainingHours(state.modal.day, start, end, state.modal.block?.id);
      const label = remainingInfo.label === 'weekend' ? 'to reach 5h this weekend' : 'to reach 8h today';
      remainingEl.textContent = `${fmtDurationHours(remainingInfo.remaining)} left ${label}`;
    };

    form.start.addEventListener('input', updateRemaining);
    form.end.addEventListener('input', updateRemaining);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const day = DateTime.fromISO(state.modal.day, { zone: TIMEZONE });
      const [startHour, startMinute] = form.start.value.split(':').map(Number);
      const [endHour, endMinute] = form.end.value.split(':').map(Number);
      const start = day.set({ hour: startHour, minute: startMinute }).toISO();
      const end = day.set({ hour: endHour, minute: endMinute }).toISO();
      const payload = { personId: state.currentActor, start, end };
      if (state.modal.block) payload.id = state.modal.block.id;
      saveBlock(payload, Boolean(state.modal.block));
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

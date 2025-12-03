const state = {
  token: localStorage.getItem('sessionToken'),
  actor: null,
  persons: [],
  weekStart: null,
  weekEnd: null,
  blocks: [],
  summaries: null
};

function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }

async function login(password) {
  const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  if (!res.ok) return false;
  state.token = 'ok';
  localStorage.setItem('sessionToken', state.token);
  return true;
}

function renderActors() {
  const container = document.getElementById('actors');
  container.innerHTML = '';
  state.persons.forEach(p => {
    const btn = document.createElement('button');
    btn.textContent = p.name;
    btn.style.borderColor = p.color;
    btn.classList.toggle('active', state.actor === p.id);
    btn.addEventListener('click', () => {
      state.actor = p.id;
      renderActors();
      renderGrid();
    });
    container.appendChild(btn);
  });
}

function formatRange(start, end) {
  return `${start.slice(11)} – ${end.slice(11)}`;
}

function renderGrid() {
  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  days.forEach((dayName, idx) => {
    const col = document.createElement('div');
    col.className = 'day-column';
    const header = document.createElement('div');
    header.className = 'day-header';
    const date = new Date(state.weekStart);
    date.setDate(date.getDate() + idx);
    header.innerHTML = `<strong>${dayName}</strong> <button data-day="${idx}">Add block</button>`;
    header.querySelector('button').addEventListener('click', () => openModal(idx));
    col.appendChild(header);

    const dayBlocks = state.blocks.filter(b => new Date(b.start).getDay() === (idx + 1));
    dayBlocks.sort((a, b) => a.start.localeCompare(b.start));
    dayBlocks.forEach(block => {
      const card = document.createElement('div');
      const person = state.persons.find(p => p.id === block.personId);
      card.className = 'block';
      card.style.background = person ? `${person.color}22` : '#e0e0e0';
      const canEdit = state.actor === block.personId;
      const headerEl = document.createElement('div');
      headerEl.className = 'block-header';
      headerEl.innerHTML = `<span>${person ? person.name : block.personId}</span><span>${formatRange(block.start, block.end)}</span>`;
      card.appendChild(headerEl);
      const meta = document.createElement('div');
      meta.className = 'meta';
      const duration = (new Date(block.end) - new Date(block.start)) / 3600000;
      meta.innerHTML = `<span>${duration.toFixed(2)}h</span>`;
      card.appendChild(meta);
      if (canEdit) {
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => openModal(idx, block));
      }
      col.appendChild(card);
    });

    const summary = state.summaries.dayStats[idx];
    const summaryEl = document.createElement('div');
    const status = summary.total >= 8 && summary.after >= 4 ? 'Complete' : summary.total >= 8 ? `Missing after-hours (${Math.max(0, 4 - summary.after).toFixed(1)}h)` : `Missing ${(8 - summary.total).toFixed(1)}h`;
    summaryEl.className = 'summary' + (summary.total > 8 || summary.early > 4 ? ' bad' : '');
    summaryEl.innerHTML = `
      <div class="line"><span>Total</span><strong>${summary.total.toFixed(2)} / 8h</strong></div>
      <div class="line"><span>Early</span><span>${summary.early.toFixed(2)}h</span></div>
      <div class="line"><span>After</span><span>${summary.after.toFixed(2)}h</span></div>
      <div class="line"><span>Status</span><span>${status}</span></div>
    `;
    col.appendChild(summaryEl);

    grid.appendChild(col);
  });
}

function renderSidebar() {
  const sidebar = document.getElementById('sidebar');
  const list = state.summaries.personTotals.map(p => `<div class="person-total"><span>${p.name}</span><strong>${p.total.toFixed(2)}h (${Math.round((p.total / 40) * 100)}%)</strong></div>`).join('');
  const ok = state.summaries.dayStats.every(d => d.total <= 8 && d.early <= 4) && state.summaries.totalWeekHours <= 40;
  sidebar.innerHTML = `
    <h3>Weekly totals</h3>
    ${list}
    <div class="overall">
      <strong>Total: ${state.summaries.totalWeekHours.toFixed(2)} / 40h</strong>
      <div>${ok ? 'On track' : 'Limits exceeded'}</div>
    </div>
  `;
}

function renderHistory(items) {
  const container = document.getElementById('history');
  container.innerHTML = '<h3>Recent changes</h3>';
  items.forEach(it => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.textContent = `${it.timestamp} – ${it.action} (${it.details})`;
    container.appendChild(div);
  });
}

async function loadWeek(startDate) {
  const param = startDate ? `?start=${startDate}` : '';
  const res = await fetch(`/api/week${param}`);
  const data = await res.json();
  state.persons = data.persons;
  state.blocks = data.blocks;
  state.weekStart = new Date(`${data.weekStart}T00:00`);
  state.weekEnd = new Date(`${data.weekEnd}T00:00`);
  state.summaries = data.summaries;
  document.getElementById('week-label').textContent = `Week ${data.weekStart} - ${data.weekEnd}`;
  if (!state.actor && data.persons.length) state.actor = data.persons[0].id;
  renderActors();
  renderGrid();
  renderSidebar();
  loadHistory();
}

async function loadHistory() {
  const res = await fetch('/api/history?limit=3');
  const data = await res.json();
  renderHistory(data.history);
}

function openModal(dayIdx, block) {
  if (!state.actor) return;
  const modal = document.createElement('div');
  modal.className = 'modal';
  const panel = document.createElement('div');
  panel.className = 'panel';
  const baseDate = new Date(state.weekStart);
  baseDate.setDate(baseDate.getDate() + dayIdx);
  const baseDateStr = baseDate.toISOString().slice(0, 10);
  panel.innerHTML = `
    <h3>${block ? 'Edit block' : 'Add block'} for ${state.actor}</h3>
    <label>Start</label>
    <input type="datetime-local" id="start" value="${block ? block.start : baseDateStr + 'T17:00'}">
    <label>End</label>
    <input type="datetime-local" id="end" value="${block ? block.end : baseDateStr + 'T21:00'}">
    <p id="modal-error" class="error"></p>
    <div class="actions">
      ${block ? '<button id="delete">Delete</button>' : ''}
      <button id="cancel">Cancel</button>
      <button id="save">Save</button>
    </div>
  `;
  modal.appendChild(panel);
  document.body.appendChild(modal);

  panel.querySelector('#cancel').onclick = () => modal.remove();
  panel.querySelector('#save').onclick = async () => {
    const start = panel.querySelector('#start').value;
    const end = panel.querySelector('#end').value;
    const payload = { personId: state.actor, start, end, actorId: state.actor };
    const url = block ? `/api/blocks/${block.id}` : '/api/blocks';
    const method = block ? 'PATCH' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) {
      panel.querySelector('#modal-error').textContent = data.error || 'Unable to save block';
      return;
    }
    await loadWeek(state.weekStart.toISOString().slice(0, 10));
    modal.remove();
  };
  if (block) {
    panel.querySelector('#delete').onclick = async () => {
      await fetch(`/api/blocks/${block.id}`, { method: 'DELETE', headers: { 'X-Actor': state.actor } });
      await loadWeek(state.weekStart.toISOString().slice(0, 10));
      modal.remove();
    };
  }
}

function attachLogin() {
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const pwd = document.getElementById('password').value;
    const ok = await login(pwd);
    if (!ok) {
      document.getElementById('login-error').textContent = 'Wrong password';
      return;
    }
    hide(document.getElementById('login'));
    show(document.getElementById('main'));
    loadWeek();
  });
}

function setupNavigation() {
  document.getElementById('prev-week').onclick = () => {
    const d = new Date(state.weekStart);
    d.setDate(d.getDate() - 7);
    loadWeek(d.toISOString().slice(0, 10));
  };
  document.getElementById('next-week').onclick = () => {
    const d = new Date(state.weekStart);
    d.setDate(d.getDate() + 7);
    loadWeek(d.toISOString().slice(0, 10));
  };
  document.getElementById('this-week').onclick = () => loadWeek();
}

function boot() {
  attachLogin();
  setupNavigation();
  if (state.token) {
    hide(document.getElementById('login'));
    show(document.getElementById('main'));
    loadWeek();
  }
}

boot();

const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.APP_PASSWORD || 'letmein';
const TIME_ZONE = 'Europe/Brussels';

const persons = [
  { id: 'anna', name: 'Anna', color: '#e57373' },
  { id: 'bob', name: 'Bob', color: '#64b5f6' },
  { id: 'carla', name: 'Carla', color: '#81c784' },
  { id: 'dave', name: 'Dave', color: '#ffb74d' }
];

const blocks = [];
const history = [];

function parseJSON(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function parseDateTime(value) {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d, hh, mm] = match.map(Number);
  return { year: y, month: m, day: d, hour: hh, minute: mm };
}

function getBrusselsOffsetMinutes(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    timeZoneName: 'short'
  }).formatToParts(date);
  const tz = parts.find(p => p.type === 'timeZoneName');
  const match = tz && tz.value.match(/GMT([+-]\d{1,2})/);
  return match ? Number(match[1]) * 60 : 0;
}

function toUtcMillis(parts) {
  const base = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  const offsetMinutes = getBrusselsOffsetMinutes(new Date(base));
  return base - offsetMinutes * 60 * 1000;
}

function formatDateTime(utcMillis) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  const parts = formatter.formatToParts(new Date(utcMillis));
  const get = type => parts.find(p => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function formatTimeRange(startMs, endMs) {
  const start = formatDateTime(startMs).split('T')[1];
  const end = formatDateTime(endMs).split('T')[1];
  return `${start}-${end}`;
}

function currentBrusselsDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: TIME_ZONE }));
}

function startOfISOWeek(date) {
  const brussels = currentBrusselsDate();
  if (date) {
    brussels.setTime(date.getTime());
  }
  const day = brussels.getDay() || 7; // Monday=1
  brussels.setDate(brussels.getDate() - day + 1);
  brussels.setHours(0, 0, 0, 0);
  const parts = {
    year: brussels.getFullYear(),
    month: brussels.getMonth() + 1,
    day: brussels.getDate(),
    hour: 0,
    minute: 0
  };
  return toUtcMillis(parts);
}

function addDays(ms, days) {
  return ms + days * 24 * 60 * 60 * 1000;
}

function dayLabel(utcMillis) {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short' });
  return formatter.format(new Date(utcMillis));
}

function computeDayStats(weekStartMs, weekBlocks) {
  const days = Array.from({ length: 5 }, (_, i) => ({
    total: 0,
    early: 0,
    after: 0
  }));
  const hourMs = 60 * 60 * 1000;
  weekBlocks.forEach(block => {
    for (let i = 0; i < 5; i++) {
      const dayStart = addDays(weekStartMs, i);
      const dayEnd = dayStart + 24 * hourMs;
      const afterEnd = dayStart + 25 * hourMs;
      const overlap = Math.max(0, Math.min(block.end, dayEnd) - Math.max(block.start, dayStart));
      if (overlap > 0) {
        days[i].total += overlap / hourMs;
      }
      const earlyOverlap = Math.max(0, Math.min(block.end, dayStart + 17 * hourMs) - Math.max(block.start, dayStart));
      if (earlyOverlap > 0) {
        days[i].early += earlyOverlap / hourMs;
      }
      const afterOverlap = Math.max(0, Math.min(block.end, afterEnd) - Math.max(block.start, dayStart + 17 * hourMs));
      if (afterOverlap > 0) {
        days[i].after += afterOverlap / hourMs;
      }
    }
  });
  return days;
}

function validateBlock(candidate, weekStartMs) {
  if (candidate.start >= candidate.end) {
    return 'Start time must be before end time.';
  }

  const maxEnd = candidate.start + 8 * 60 * 60 * 1000;
  if (candidate.end > maxEnd) {
    return 'Blocks may not exceed 8 hours.';
  }

  // Overlap check for person
  const others = blocks.filter(b => b.personId === candidate.personId && b.id !== candidate.id);
  const overlap = others.find(b => !(candidate.end <= b.start || candidate.start >= b.end));
  if (overlap) {
    return 'This person already has a block that overlaps with the chosen time.';
  }

  // Week filter
  const weekEnd = addDays(weekStartMs, 5);
  const touchesWeek = candidate.start < weekEnd && candidate.end > weekStartMs;
  if (!touchesWeek) {
    return 'Block must belong to the selected week.';
  }

  const weekBlocks = blocks
    .filter(b => b.id !== candidate.id)
    .filter(b => b.start < weekEnd && b.end > weekStartMs);
  weekBlocks.push(candidate);
  const dayStats = computeDayStats(weekStartMs, weekBlocks);

  for (let i = 0; i < dayStats.length; i++) {
    if (dayStats[i].total > 8 + 1e-9) {
      return `This change would exceed 8h total for ${dayLabel(addDays(weekStartMs, i))}.`;
    }
    if (dayStats[i].early > 4 + 1e-9) {
      return `This change would make more than 4h before 17:00 on ${dayLabel(addDays(weekStartMs, i))}.`;
    }
  }

  const weekTotal = dayStats.reduce((sum, d) => sum + d.total, 0);
  if (weekTotal > 40 + 1e-9) {
    return 'This change would push the week over 40 hours.';
  }

  return null;
}

function weekSummaries(weekStartMs) {
  const weekEnd = addDays(weekStartMs, 5);
  const weekBlocks = blocks.filter(b => b.start < weekEnd && b.end > weekStartMs);
  const dayStats = computeDayStats(weekStartMs, weekBlocks);
  const personTotals = persons.map(person => {
    const total = weekBlocks
      .filter(b => b.personId === person.id)
      .reduce((sum, b) => sum + (b.end - b.start) / (60 * 60 * 1000), 0);
    return { personId: person.id, name: person.name, total };
  });
  const totalWeekHours = dayStats.reduce((sum, d) => sum + d.total, 0);
  return { dayStats, personTotals, totalWeekHours };
}

function respond(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function serveStatic(req, res) {
  const filePath = req.url === '/' ? '/index.html' : req.url;
  const resolved = path.join(__dirname, '../public', path.normalize(filePath.replace(/^\//, '')));
  if (!resolved.startsWith(path.join(__dirname, '../public'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
    const content = fs.readFileSync(resolved);
    const ext = path.extname(resolved);
    const type = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : 'text/plain';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
    return true;
  }
  return false;
}

function addHistory(actorId, targetId, action, detail) {
  history.unshift({
    id: randomUUID(),
    timestamp: Date.now(),
    actorPersonId: actorId,
    targetPersonId: targetId,
    action,
    details: detail
  });
  if (history.length > 50) history.pop();
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && !req.url.startsWith('/api')) {
    if (serveStatic(req, res)) return;
  }

  if (req.url === '/api/login' && req.method === 'POST') {
    try {
      const body = await parseJSON(req);
      if (body.password === PASSWORD) {
        respond(res, 200, { token: 'ok' });
      } else {
        respond(res, 401, { error: 'Invalid password' });
      }
    } catch (err) {
      respond(res, 400, { error: 'Bad request' });
    }
    return;
  }

  if (req.url.startsWith('/api/week') && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const startParam = url.searchParams.get('start');
    let weekStartMs;
    if (startParam) {
      const parts = parseDateTime(`${startParam}T00:00`);
      weekStartMs = toUtcMillis(parts);
    } else {
      weekStartMs = startOfISOWeek();
    }
    const weekEnd = addDays(weekStartMs, 5);
    const weekBlocks = blocks.filter(b => b.start < weekEnd && b.end > weekStartMs);
    const summaries = weekSummaries(weekStartMs);
    respond(res, 200, {
      persons,
      blocks: weekBlocks.map(b => ({ ...b, start: formatDateTime(b.start), end: formatDateTime(b.end) })),
      weekStart: formatDateTime(weekStartMs).split('T')[0],
      weekEnd: formatDateTime(addDays(weekStartMs, 4)).split('T')[0],
      summaries
    });
    return;
  }

  if (req.url === '/api/blocks' && req.method === 'POST') {
    try {
      const body = await parseJSON(req);
      const partsStart = parseDateTime(body.start);
      const partsEnd = parseDateTime(body.end);
      if (!partsStart || !partsEnd || !body.personId) {
        respond(res, 400, { error: 'Missing parameters' });
        return;
      }
      const startMs = toUtcMillis(partsStart);
      const endMs = toUtcMillis(partsEnd);
      const weekStartMs = startOfISOWeek(new Date(startMs));
      const candidate = { id: randomUUID(), personId: body.personId, start: startMs, end: endMs };
      const error = validateBlock(candidate, weekStartMs);
      if (error) {
        respond(res, 400, { error });
        return;
      }
      blocks.push(candidate);
      addHistory(body.actorId || body.personId, body.personId, 'create', `Created block ${formatTimeRange(startMs, endMs)} for ${body.personId}`);
      respond(res, 200, { block: { ...candidate, start: body.start, end: body.end } });
    } catch (err) {
      respond(res, 400, { error: 'Bad request' });
    }
    return;
  }

  if (req.url.startsWith('/api/blocks/') && req.method === 'PATCH') {
    try {
      const id = req.url.split('/').pop();
      const existing = blocks.find(b => b.id === id);
      if (!existing) {
        respond(res, 404, { error: 'Not found' });
        return;
      }
      const body = await parseJSON(req);
      const partsStart = parseDateTime(body.start);
      const partsEnd = parseDateTime(body.end);
      if (!partsStart || !partsEnd) {
        respond(res, 400, { error: 'Missing parameters' });
        return;
      }
      const startMs = toUtcMillis(partsStart);
      const endMs = toUtcMillis(partsEnd);
      const weekStartMs = startOfISOWeek(new Date(startMs));
      const candidate = { ...existing, start: startMs, end: endMs };
      const error = validateBlock(candidate, weekStartMs);
      if (error) {
        respond(res, 400, { error });
        return;
      }
      existing.start = startMs;
      existing.end = endMs;
      addHistory(body.actorId || existing.personId, existing.personId, 'update', `Updated block to ${formatTimeRange(startMs, endMs)} for ${existing.personId}`);
      respond(res, 200, { block: { ...existing, start: body.start, end: body.end } });
    } catch (err) {
      respond(res, 400, { error: 'Bad request' });
    }
    return;
  }

  if (req.url.startsWith('/api/blocks/') && req.method === 'DELETE') {
    const id = req.url.split('/').pop();
    const idx = blocks.findIndex(b => b.id === id);
    if (idx === -1) {
      respond(res, 404, { error: 'Not found' });
      return;
    }
    const [removed] = blocks.splice(idx, 1);
    addHistory(req.headers['x-actor'] || removed.personId, removed.personId, 'delete', `Deleted block ${formatTimeRange(removed.start, removed.end)} for ${removed.personId}`);
    respond(res, 200, { ok: true });
    return;
  }

  if (req.url.startsWith('/api/history') && req.method === 'GET') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = Number(url.searchParams.get('limit') || 3);
    const items = history.slice(0, limit).map(item => ({
      ...item,
      timestamp: formatDateTime(item.timestamp)
    }));
    respond(res, 200, { history: items });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

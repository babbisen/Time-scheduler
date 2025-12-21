import express from 'express';
import cookieParser from 'cookie-parser';
import { DateTime, Interval } from 'luxon';
import { nanoid } from 'nanoid';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.APP_PASSWORD || 'letmein';
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TIMEZONE = 'Europe/Brussels';

const sessions = new Set();

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    const seed = {
      persons: [
        { id: 'anna', name: 'Anna', color: '#3b82f6' },
        { id: 'bob', name: 'Bob', color: '#22c55e' },
        { id: 'carla', name: 'Carla', color: '#f97316' },
        { id: 'dan', name: 'Dan', color: '#a855f7' }
      ],
      blocks: [],
      history: []
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
  }
  const content = fs.readFileSync(DB_FILE, 'utf-8');
  return JSON.parse(content);
}

let db = loadDb();

function saveDb() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

function requireAuth(req, res, next) {
  const token = req.cookies.session;
  if (token && sessions.has(token)) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
}

function weekStart(dateIso) {
  const dt = DateTime.fromISO(dateIso, { zone: TIMEZONE }).startOf('day');
  const monday = dt.startOf('week');
  return monday.toISODate();
}

function getWeekRange(startIso) {
  const monday = DateTime.fromISO(startIso, { zone: TIMEZONE }).startOf('day');
  return {
    start: monday,
    end: monday.plus({ days: 5 })
  };
}

function intervalOverlap(aStart, aEnd, bStart, bEnd) {
  const intA = Interval.fromDateTimes(aStart, aEnd);
  const intB = Interval.fromDateTimes(bStart, bEnd);
  return intA.overlaps(intB);
}

function durationInHours(start, end) {
  return end.diff(start, 'minutes').minutes / 60;
}

function getDayFragments(block) {
  const start = DateTime.fromISO(block.start, { zone: TIMEZONE });
  const end = DateTime.fromISO(block.end, { zone: TIMEZONE });
  const days = [];
  let cursor = start.startOf('day');
  const finalDay = end.minus({ milliseconds: 1 }).startOf('day');
  while (cursor <= finalDay) {
    const dayStart = cursor;
    const dayEnd = cursor.plus({ days: 1 });
    const segmentStart = start > dayStart ? start : dayStart;
    const segmentEnd = end < dayEnd ? end : dayEnd;
    if (segmentEnd > segmentStart) {
      const earlyStart = dayStart;
      const earlyEnd = dayStart.set({ hour: 17 });
      const afterStart = earlyEnd;
      const afterEnd = dayStart.plus({ days: 1 }).set({ hour: 1 });
      const total = durationInHours(segmentStart, segmentEnd);
      const early = Math.max(
        0,
        durationInHours(
          segmentStart < earlyStart ? earlyStart : segmentStart,
          segmentEnd > earlyEnd ? earlyEnd : segmentEnd
        )
      );
      const after = Math.max(
        0,
        durationInHours(
          segmentStart < afterStart ? afterStart : segmentStart,
          segmentEnd > afterEnd ? afterEnd : segmentEnd
        )
      );
      days.push({ date: dayStart.toISODate(), total, early, after });
    }
    cursor = cursor.plus({ days: 1 });
  }
  return days;
}

function computeDaySummaries(blocks, weekRange) {
  const summaries = {};
  for (let i = 0; i < 5; i++) {
    const date = weekRange.start.plus({ days: i }).toISODate();
    summaries[date] = { total: 0, early: 0, after: 0, blocks: [] };
  }

  blocks.forEach((block) => {
    const fragments = getDayFragments(block);
    fragments.forEach((frag) => {
      if (summaries[frag.date]) {
        summaries[frag.date].total += frag.total;
        summaries[frag.date].early += frag.early;
        summaries[frag.date].after += frag.after;
        summaries[frag.date].blocks.push(block.id);
      }
    });
  });

  Object.keys(summaries).forEach((date) => {
    summaries[date].total = Number(summaries[date].total.toFixed(2));
    summaries[date].early = Number(summaries[date].early.toFixed(2));
    summaries[date].after = Number(summaries[date].after.toFixed(2));
  });

  return summaries;
}

function computePersonSummaries(blocks, weekRange) {
  const totals = {};
  blocks.forEach((block) => {
    const start = DateTime.fromISO(block.start, { zone: TIMEZONE });
    if (start < weekRange.start || start >= weekRange.end) return;
    const duration = durationInHours(start, DateTime.fromISO(block.end, { zone: TIMEZONE }));
    totals[block.personId] = (totals[block.personId] || 0) + duration;
  });
  Object.keys(totals).forEach((id) => {
    totals[id] = Number(totals[id].toFixed(2));
  });
  return totals;
}

function computeWeekTotals(daySummaries) {
  return Object.values(daySummaries).reduce((sum, d) => sum + d.total, 0);
}

function validateBlock(newBlock, blocks, weekRange, isUpdate = false) {
  const errors = [];
  const start = DateTime.fromISO(newBlock.start, { zone: TIMEZONE });
  const end = DateTime.fromISO(newBlock.end, { zone: TIMEZONE });

  if (!start.isValid || !end.isValid) {
    errors.push('Start and end must be valid datetimes.');
    return errors;
  }

  if (start >= end) {
    errors.push('Start must be before end.');
    return errors;
  }

  if (start < weekRange.start || start >= weekRange.end) {
    errors.push('Start must be inside the selected week (Mon–Fri).');
    return errors;
  }

  const nextDayOne = start.plus({ days: 1, hours: 1 });
  if (end > nextDayOne) {
    errors.push('Blocks may not extend past 01:00 of the following day.');
    return errors;
  }

  const candidateBlocks = blocks.filter((b) => b.id !== newBlock.id);

  // overlap
  for (const b of candidateBlocks) {
    if (b.personId !== newBlock.personId) continue;
    const bStart = DateTime.fromISO(b.start, { zone: TIMEZONE });
    const bEnd = DateTime.fromISO(b.end, { zone: TIMEZONE });
    if (intervalOverlap(start, end, bStart, bEnd)) {
      errors.push('This block overlaps with another for the same person.');
      break;
    }
  }

  if (errors.length) return errors;

  const merged = [...candidateBlocks, newBlock];
  const daySummaries = computeDaySummaries(merged, weekRange);

  for (let i = 0; i < 5; i++) {
    const day = weekRange.start.plus({ days: i }).toISODate();
    const summary = daySummaries[day];
    if (summary.total - 1e-9 > 8) {
      errors.push(`This change would exceed 8h total for ${DateTime.fromISO(day).toFormat('cccc')}.`);
      break;
    }
    if (summary.early - 1e-9 > 4) {
      errors.push(`This change would make more than 4h before 17:00 on ${DateTime.fromISO(day).toFormat('cccc')}.`);
      break;
    }
  }

  const weekTotal = computeWeekTotals(daySummaries);
  if (weekTotal - 1e-9 > 40) {
    errors.push('This change would exceed 40h for the week.');
  }

  return errors;
}

function getWeekBlocks(startIso) {
  const { start, end } = getWeekRange(startIso);
  return db.blocks.filter((b) => {
    const s = DateTime.fromISO(b.start, { zone: TIMEZONE });
    return s >= start && s < end;
  });
}

function buildWeekPayload(startIso) {
  const weekRange = getWeekRange(startIso);
  const weekBlocks = getWeekBlocks(startIso);
  const daySummaries = computeDaySummaries(weekBlocks, weekRange);
  const personSummaries = computePersonSummaries(weekBlocks, weekRange);
  const weekTotal = Number(computeWeekTotals(daySummaries).toFixed(2));
  return {
    weekStart: weekRange.start.toISODate(),
    weekEnd: weekRange.end.minus({ days: 1 }).toISODate(),
    persons: db.persons,
    blocks: weekBlocks,
    daySummaries,
    personSummaries,
    weekTotal
  };
}

app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    const token = nanoid();
    sessions.add(token);
    res.cookie('session', token, { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.get('/api/week', requireAuth, (req, res) => {
  const startParam = req.query.start;
  if (!startParam) return res.status(400).json({ error: 'start is required (YYYY-MM-DD)' });
  const wkStart = weekStart(startParam);
  res.json(buildWeekPayload(wkStart));
});

app.get('/api/history', requireAuth, (req, res) => {
  const limit = Number(req.query.limit || 3);
  res.json(db.history.slice(-limit).reverse());
});

app.post('/api/blocks', requireAuth, (req, res) => {
  const { personId, start, end } = req.body;
  if (!personId || !start || !end) return res.status(400).json({ error: 'personId, start and end are required.' });
  const weekRange = getWeekRange(weekStart(start));
  const newBlock = { id: nanoid(), personId, start, end };
  const errors = validateBlock(newBlock, db.blocks, weekRange);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  db.blocks.push(newBlock);
  db.history.push({
    id: nanoid(),
    timestamp: DateTime.now().setZone(TIMEZONE).toISO(),
    actorPersonId: req.headers['x-actor'] || personId,
    targetPersonId: personId,
    action: 'create',
    details: `Created block ${DateTime.fromISO(start).toFormat('HH:mm')}–${DateTime.fromISO(end).toFormat('HH:mm')} for ${personId}`
  });
  saveDb();
  res.json(buildWeekPayload(weekRange.start.toISODate()));
});

app.patch('/api/blocks/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const idx = db.blocks.findIndex((b) => b.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Block not found' });
  const original = db.blocks[idx];
  const updated = { ...original, ...req.body };
  const weekRange = getWeekRange(weekStart(updated.start));
  const errors = validateBlock(updated, db.blocks, weekRange, true);
  if (errors.length) return res.status(400).json({ error: errors.join(' ') });
  db.blocks[idx] = updated;
  db.history.push({
    id: nanoid(),
    timestamp: DateTime.now().setZone(TIMEZONE).toISO(),
    actorPersonId: req.headers['x-actor'] || updated.personId,
    targetPersonId: updated.personId,
    action: 'update',
    details: `Updated block on ${DateTime.fromISO(updated.start).toFormat('ccc')} for ${updated.personId}`
  });
  saveDb();
  res.json(buildWeekPayload(weekRange.start.toISODate()));
});

app.delete('/api/blocks/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const idx = db.blocks.findIndex((b) => b.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Block not found' });
  const block = db.blocks[idx];
  db.blocks.splice(idx, 1);
  db.history.push({
    id: nanoid(),
    timestamp: DateTime.now().setZone(TIMEZONE).toISO(),
    actorPersonId: req.headers['x-actor'] || block.personId,
    targetPersonId: block.personId,
    action: 'delete',
    details: `Deleted block ${DateTime.fromISO(block.start).toFormat('ccc HH:mm')} for ${block.personId}`
  });
  saveDb();
  res.json(buildWeekPayload(weekStart(block.start)));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

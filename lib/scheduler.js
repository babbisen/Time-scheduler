import { DateTime, Interval } from 'luxon';
import { TIMEZONE } from './db.js';

export function weekStart(dateIso) {
  const dt = DateTime.fromISO(dateIso, { zone: TIMEZONE }).startOf('day');
  const monday = dt.startOf('week');
  return monday.toISODate();
}

export function getWeekRange(startIso) {
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

export function computeDaySummaries(blocks, weekRange) {
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

export function computePersonSummaries(blocks, weekRange) {
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

export function computeWeekTotals(daySummaries) {
  return Object.values(daySummaries).reduce((sum, d) => sum + d.total, 0);
}

export function validateBlock(newBlock, blocks, weekRange) {
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
  }

  const weekTotal = computeWeekTotals(daySummaries);
  if (weekTotal - 1e-9 > 40) {
    errors.push('This change would exceed 40h for the week.');
  }

  return errors;
}

export function getWeekBlocks(db, startIso) {
  const { start, end } = getWeekRange(startIso);
  return db.blocks.filter((b) => {
    const s = DateTime.fromISO(b.start, { zone: TIMEZONE });
    return s >= start && s < end;
  });
}

export function buildWeekPayload(db, startIso) {
  const weekRange = getWeekRange(startIso);
  const weekBlocks = getWeekBlocks(db, startIso);
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

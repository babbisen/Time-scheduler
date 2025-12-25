import { DateTime, Interval } from 'luxon';
import { TIMEZONE } from './db.js';

function toDateTime(value) {
  if (value instanceof Date) {
    return DateTime.fromJSDate(value, { zone: TIMEZONE });
  }
  return DateTime.fromISO(value, { zone: TIMEZONE });
}

export function weekStart(dateIso) {
  const dt = DateTime.fromISO(dateIso, { zone: TIMEZONE }).startOf('day');
  const monday = dt.startOf('week');
  return monday.toISODate();
}

export function getWeekRange(startIso) {
  const monday = DateTime.fromISO(startIso, { zone: TIMEZONE }).startOf('day');
  return {
    start: monday,
    end: monday.plus({ days: 7 })
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
  const start = toDateTime(block.start);
  const end = toDateTime(block.end);
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
  for (let i = 0; i < 7; i++) {
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
    const start = toDateTime(block.start);
    if (start < weekRange.start || start >= weekRange.end) return;
    const duration = durationInHours(start, toDateTime(block.end));
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
  const start = toDateTime(newBlock.start);
  const end = toDateTime(newBlock.end);

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
    const bStart = toDateTime(b.start);
    const bEnd = toDateTime(b.end);
    if (intervalOverlap(start, end, bStart, bEnd)) {
      errors.push('This block overlaps with another for the same person.');
      break;
    }
  }

  if (errors.length) return errors;

  const merged = [...candidateBlocks, newBlock];
  const daySummaries = computeDaySummaries(merged, weekRange);

  for (let i = 0; i < 7; i++) {
    const day = weekRange.start.plus({ days: i }).toISODate();
    const summary = daySummaries[day];
    if (summary.total - 1e-9 > 8) {
      errors.push(`This change would exceed 8h total for ${DateTime.fromISO(day).toFormat('cccc')}.`);
      break;
    }
  }

  const saturday = weekRange.start.plus({ days: 5 }).toISODate();
  const sunday = weekRange.start.plus({ days: 6 }).toISODate();
  const weekendTotal = (daySummaries[saturday]?.total || 0) + (daySummaries[sunday]?.total || 0);
  if (weekendTotal - 1e-9 > 5) {
    errors.push('This change would exceed 5h total across Saturday and Sunday.');
  }

  const weekTotal = computeWeekTotals(daySummaries);
  if (weekTotal - 1e-9 > 40) {
    errors.push('This change would exceed 40h for the week.');
  }

  return errors;
}

export function buildWeekPayload({ persons, blocks }, startIso) {
  const weekRange = getWeekRange(startIso);
  const daySummaries = computeDaySummaries(blocks, weekRange);
  const personSummaries = computePersonSummaries(blocks, weekRange);
  const weekTotal = Number(computeWeekTotals(daySummaries).toFixed(2));
  return {
    weekStart: weekRange.start.toISODate(),
    weekEnd: weekRange.end.minus({ days: 1 }).toISODate(),
    persons,
    blocks,
    daySummaries,
    personSummaries,
    weekTotal
  };
}

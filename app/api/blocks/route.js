import { NextResponse } from 'next/server';
import { DateTime } from 'luxon';
import { nanoid } from 'nanoid';
import { loadDb, saveDb, TIMEZONE } from '../../../lib/db.js';
import { buildWeekPayload, getWeekRange, validateBlock, weekStart } from '../../../lib/scheduler.js';
import { requireAuth } from '../../../lib/auth.js';

export async function POST(request) {
  const body = await request.json();
  const { personId, start, end } = body || {};

  if (!personId || !start || !end) {
    return NextResponse.json({ error: 'personId, start and end are required.' }, { status: 400 });
  }

  const db = loadDb();
  const auth = requireAuth(db);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const weekRange = getWeekRange(weekStart(start));
  const newBlock = { id: nanoid(), personId, start, end };
  const errors = validateBlock(newBlock, db.blocks, weekRange);
  if (errors.length) {
    return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
  }

  db.blocks.push(newBlock);
  db.history.push({
    id: nanoid(),
    timestamp: DateTime.now().setZone(TIMEZONE).toISO(),
    actorPersonId: request.headers.get('x-actor') || personId,
    targetPersonId: personId,
    action: 'create',
    details: `Created block ${DateTime.fromISO(start).toFormat('HH:mm')}–${DateTime.fromISO(end).toFormat('HH:mm')} for ${personId}`
  });
  saveDb(db);
  return NextResponse.json(buildWeekPayload(db, weekRange.start.toISODate()));
}

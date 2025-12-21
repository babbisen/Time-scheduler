import { NextResponse } from 'next/server';
import { DateTime } from 'luxon';
import { nanoid } from 'nanoid';
import { loadDb, saveDb, TIMEZONE } from '../../../../lib/db.js';
import { buildWeekPayload, getWeekRange, validateBlock, weekStart } from '../../../../lib/scheduler.js';
import { requireAuth } from '../../../../lib/auth.js';

export async function PATCH(request, { params }) {
  const { id } = params;
  const body = await request.json();

  const db = loadDb();
  const auth = requireAuth(db);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const idx = db.blocks.findIndex((b) => b.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: 'Block not found' }, { status: 404 });
  }

  const original = db.blocks[idx];
  const updated = { ...original, ...body };
  const weekRange = getWeekRange(weekStart(updated.start));
  const errors = validateBlock(updated, db.blocks, weekRange);
  if (errors.length) {
    return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
  }

  db.blocks[idx] = updated;
  db.history.push({
    id: nanoid(),
    timestamp: DateTime.now().setZone(TIMEZONE).toISO(),
    actorPersonId: request.headers.get('x-actor') || updated.personId,
    targetPersonId: updated.personId,
    action: 'update',
    details: `Updated block on ${DateTime.fromISO(updated.start).toFormat('ccc')} for ${updated.personId}`
  });
  saveDb(db);
  return NextResponse.json(buildWeekPayload(db, weekRange.start.toISODate()));
}

export async function DELETE(request, { params }) {
  const { id } = params;

  const db = loadDb();
  const auth = requireAuth(db);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const idx = db.blocks.findIndex((b) => b.id === id);
  if (idx === -1) {
    return NextResponse.json({ error: 'Block not found' }, { status: 404 });
  }

  const block = db.blocks[idx];
  db.blocks.splice(idx, 1);
  db.history.push({
    id: nanoid(),
    timestamp: DateTime.now().setZone(TIMEZONE).toISO(),
    actorPersonId: request.headers.get('x-actor') || block.personId,
    targetPersonId: block.personId,
    action: 'delete',
    details: `Deleted block ${DateTime.fromISO(block.start).toFormat('ccc HH:mm')} for ${block.personId}`
  });
  saveDb(db);
  return NextResponse.json(buildWeekPayload(db, weekStart(block.start)));
}

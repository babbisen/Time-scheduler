import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { prisma, ensurePersons, TIMEZONE } from '../../../lib/db.js';
import { buildWeekPayload, getWeekRange, validateBlock, weekStart } from '../../../lib/scheduler.js';
import { requireAuth } from '../../../lib/auth.js';
import { DateTime } from 'luxon';

export async function POST(request) {
  const body = await request.json();
  const { personId, start, end } = body || {};

  if (!personId || !start || !end) {
    return NextResponse.json({ error: 'personId, start and end are required.' }, { status: 400 });
  }

  const auth = requireAuth();
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const weekRange = getWeekRange(weekStart(start));
  const newBlock = { id: nanoid(), personId, start, end };
  const existingBlocks = await prisma.block.findMany({
    where: {
      start: {
        gte: weekRange.start.toJSDate(),
        lt: weekRange.end.toJSDate()
      }
    }
  });
  const normalizedExisting = existingBlocks.map((block) => ({
    ...block,
    start: block.start.toISOString(),
    end: block.end.toISOString()
  }));
  const errors = validateBlock(newBlock, normalizedExisting, weekRange);
  if (errors.length) {
    return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
  }

  await ensurePersons();
  await prisma.block.create({
    data: {
      id: newBlock.id,
      personId,
      start: new Date(start),
      end: new Date(end)
    }
  });
  await prisma.history.create({
    data: {
      id: nanoid(),
      timestamp: DateTime.now().setZone(TIMEZONE).toJSDate(),
      actorPersonId: request.headers.get('x-actor') || personId,
      targetPersonId: personId,
      action: 'create',
      details: `Created block ${DateTime.fromISO(start).toFormat('HH:mm')}–${DateTime.fromISO(end).toFormat('HH:mm')} for ${personId}`
    }
  });

  const [persons, blocks] = await Promise.all([
    prisma.person.findMany({ orderBy: { id: 'asc' } }),
    prisma.block.findMany({
      where: {
        start: {
          gte: weekRange.start.toJSDate(),
          lt: weekRange.end.toJSDate()
        }
      },
      orderBy: { start: 'asc' }
    })
  ]);
  const normalizedBlocks = blocks.map((block) => ({
    ...block,
    start: block.start.toISOString(),
    end: block.end.toISOString()
  }));
  return NextResponse.json(buildWeekPayload({ persons, blocks: normalizedBlocks }, weekRange.start.toISODate()));
}

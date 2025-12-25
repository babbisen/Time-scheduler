import { NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { prisma, ensurePersons, TIMEZONE } from '../../../../lib/db.js';
import { buildWeekPayload, getWeekRange, validateBlock, weekStart } from '../../../../lib/scheduler.js';
import { requireAuth } from '../../../../lib/auth.js';
import { DateTime } from 'luxon';

export async function PATCH(request, { params }) {
  const { id } = params;
  const body = await request.json();

  const auth = requireAuth();
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const existingBlock = await prisma.block.findUnique({ where: { id } });
  if (!existingBlock) {
    return NextResponse.json({ error: 'Block not found' }, { status: 404 });
  }

  const original = {
    ...existingBlock,
    start: existingBlock.start.toISOString(),
    end: existingBlock.end.toISOString()
  };
  const updated = { ...original, ...body };
  const weekRange = getWeekRange(weekStart(updated.start));
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
  const errors = validateBlock(updated, normalizedExisting, weekRange);
  if (errors.length) {
    return NextResponse.json({ error: errors.join(' ') }, { status: 400 });
  }

  await ensurePersons();
  await prisma.block.update({
    where: { id },
    data: {
      personId: updated.personId,
      start: new Date(updated.start),
      end: new Date(updated.end)
    }
  });
  await prisma.history.create({
    data: {
      id: nanoid(),
      timestamp: DateTime.now().setZone(TIMEZONE).toJSDate(),
      actorPersonId: request.headers.get('x-actor') || updated.personId,
      targetPersonId: updated.personId,
      action: 'update',
      details: `Updated block on ${DateTime.fromISO(updated.start).toFormat('ccc')} for ${updated.personId}`
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

export async function DELETE(request, { params }) {
  const { id } = params;

  const auth = requireAuth();
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const existingBlock = await prisma.block.findUnique({ where: { id } });
  if (!existingBlock) {
    return NextResponse.json({ error: 'Block not found' }, { status: 404 });
  }

  const block = {
    ...existingBlock,
    start: existingBlock.start.toISOString(),
    end: existingBlock.end.toISOString()
  };
  await prisma.block.delete({ where: { id } });
  await prisma.history.create({
    data: {
      id: nanoid(),
      timestamp: DateTime.now().setZone(TIMEZONE).toJSDate(),
      actorPersonId: request.headers.get('x-actor') || block.personId,
      targetPersonId: block.personId,
      action: 'delete',
      details: `Deleted block ${DateTime.fromISO(block.start).toFormat('ccc HH:mm')} for ${block.personId}`
    }
  });
  const wkStart = weekStart(block.start);
  const weekRange = getWeekRange(wkStart);
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
  const normalizedBlocks = blocks.map((entry) => ({
    ...entry,
    start: entry.start.toISOString(),
    end: entry.end.toISOString()
  }));
  return NextResponse.json(buildWeekPayload({ persons, blocks: normalizedBlocks }, wkStart));
}

import { NextResponse } from 'next/server';
import { prisma, ensurePersons } from '../../../lib/db.js';
import { buildWeekPayload, getWeekRange, weekStart } from '../../../lib/scheduler.js';
import { requireAuth } from '../../../lib/auth.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const startParam = searchParams.get('start');
  if (!startParam) {
    return NextResponse.json({ error: 'start is required (YYYY-MM-DD)' }, { status: 400 });
  }

  const auth = requireAuth();
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const wkStart = weekStart(startParam);
  const weekRange = getWeekRange(wkStart);
  await ensurePersons();
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
  return NextResponse.json(buildWeekPayload({ persons, blocks: normalizedBlocks }, wkStart));
}

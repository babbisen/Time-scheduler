import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db.js';
import { requireAuth } from '../../../lib/auth.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') || 3);

  const auth = requireAuth();
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const history = await prisma.history.findMany({
    orderBy: { timestamp: 'desc' },
    take: limit
  });
  const normalized = history.map((entry) => ({
    ...entry,
    timestamp: entry.timestamp.toISOString()
  }));
  return NextResponse.json(normalized);
}

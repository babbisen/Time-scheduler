import { NextResponse } from 'next/server';
import { loadDb, saveDb } from '../../../lib/db.js';
import { buildWeekPayload, weekStart } from '../../../lib/scheduler.js';
import { requireAuth } from '../../../lib/auth.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const startParam = searchParams.get('start');
  if (!startParam) {
    return NextResponse.json({ error: 'start is required (YYYY-MM-DD)' }, { status: 400 });
  }

  const db = loadDb();
  const auth = requireAuth(db);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  saveDb(db);

  const wkStart = weekStart(startParam);
  return NextResponse.json(buildWeekPayload(db, wkStart));
}

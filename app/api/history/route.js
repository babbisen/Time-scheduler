import { NextResponse } from 'next/server';
import { loadDb, saveDb } from '../../../lib/db.js';
import { requireAuth } from '../../../lib/auth.js';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') || 3);

  const db = loadDb();
  const auth = requireAuth(db);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  saveDb(db);

  return NextResponse.json(db.history.slice(-limit).reverse());
}

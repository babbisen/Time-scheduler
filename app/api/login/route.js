import { NextResponse } from 'next/server';
import { createSession, loadDb, saveDb, TIMEZONE } from '../../../lib/db.js';
import { DateTime } from 'luxon';

export async function POST(request) {
  await request.json().catch(() => ({}));

  const db = loadDb();
  const session = createSession(db);
  saveDb(db);

  const response = NextResponse.json({ success: true });
  response.cookies.set('session', session.token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60
  });
  response.headers.set('x-session-expires', DateTime.fromISO(session.expiresAt, { zone: TIMEZONE }).toISO());
  return response;
}

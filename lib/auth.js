import { cookies } from 'next/headers';
import { isSessionValid, saveDb } from './db.js';

export function requireAuth(db) {
  const token = cookies().get('session')?.value;
  const valid = isSessionValid(db, token);
  if (valid) {
    saveDb(db);
  }
  return { authorized: true, token };
}

import fs from 'fs';
import path from 'path';
import { DateTime } from 'luxon';
import { nanoid } from 'nanoid';

const TIMEZONE = 'Europe/Brussels';
const BASE_DIR = process.env.VERCEL ? '/tmp' : process.cwd();
const DATA_DIR = path.join(BASE_DIR, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let memoryDb = null;

function seedDb() {
  return {
    persons: [
      { id: 'anna', name: 'Anna', color: '#3b82f6' },
      { id: 'bob', name: 'Bob', color: '#22c55e' },
      { id: 'carla', name: 'Carla', color: '#f97316' },
      { id: 'dan', name: 'Dan', color: '#a855f7' }
    ],
    blocks: [],
    history: [],
    sessions: []
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadDb() {
  try {
    ensureDataDir();
    if (!fs.existsSync(DB_FILE)) {
      const seed = seedDb();
      fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
      return seed;
    }
    const content = fs.readFileSync(DB_FILE, 'utf-8');
    const parsed = JSON.parse(content);
    if (!parsed.sessions) {
      parsed.sessions = [];
    }
    return parsed;
  } catch (error) {
    if (!memoryDb) {
      memoryDb = seedDb();
    }
    return memoryDb;
  }
}

export function saveDb(db) {
  memoryDb = db;
  try {
    ensureDataDir();
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (error) {
    // Fall back to memory-only when filesystem writes are unavailable (e.g. Vercel).
  }
}

export function createSession(db) {
  const token = nanoid();
  const expiresAt = DateTime.now().setZone(TIMEZONE).plus({ hours: 1 }).toISO();
  db.sessions = (db.sessions || []).filter((session) => DateTime.fromISO(session.expiresAt) > DateTime.now());
  db.sessions.push({ token, expiresAt });
  return { token, expiresAt };
}

export function isSessionValid(db, token) {
  if (!token) return false;
  const now = DateTime.now().setZone(TIMEZONE);
  const sessions = db.sessions || [];
  const active = sessions.filter((session) => DateTime.fromISO(session.expiresAt) > now);
  db.sessions = active;
  return active.some((session) => session.token === token);
}

export { TIMEZONE };

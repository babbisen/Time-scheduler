import { PrismaClient } from '@prisma/client';

export const TIMEZONE = 'Europe/Brussels';

const globalForPrisma = globalThis;

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: ['error', 'warn']
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export const defaultPersons = [
  { id: 'sigve', name: 'Sigve', color: '#3b82f6' },
  { id: 'feriel', name: 'Feriel', color: '#22c55e' },
  { id: 'nicolai', name: 'Nicolai', color: '#f97316' },
  { id: 'sigurd', name: 'Sigurd', color: '#a855f7' }
];

export async function ensurePersons() {
  await Promise.all(
    defaultPersons.map((person) =>
      prisma.person.upsert({
        where: { id: person.id },
        update: { name: person.name, color: person.color },
        create: person
      })
    )
  );
}

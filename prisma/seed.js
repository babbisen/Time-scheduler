import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const defaultPersons = [
  { id: 'anna', name: 'Anna', color: '#3b82f6' },
  { id: 'bob', name: 'Bob', color: '#22c55e' },
  { id: 'carla', name: 'Carla', color: '#f97316' },
  { id: 'dan', name: 'Dan', color: '#a855f7' }
];

async function main() {
  const existing = await prisma.person.count();
  if (existing === 0) {
    await prisma.person.createMany({ data: defaultPersons });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

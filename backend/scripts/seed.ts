import prisma from '../src/lib/prisma.js';
import { seed } from '../src/lib/seed.js';

try {
  await seed();
} catch (error) {
  console.error('[Seeder] Failed to seed data.', error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

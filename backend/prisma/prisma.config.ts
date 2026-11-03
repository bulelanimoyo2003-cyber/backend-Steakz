import { defineConfig } from 'prisma';

if (!process.env.DATABASE_URL?.trim()) {
  throw new Error('DATABASE_URL must be configured for the PostgreSQL backend.');
}

export default defineConfig({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

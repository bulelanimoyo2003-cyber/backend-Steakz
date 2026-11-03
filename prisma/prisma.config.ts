import { defineConfig } from 'prisma';

export default defineConfig({
  datasources: {
    db: {
      url: process.env.DATABASE_URL ?? 'file:../backend/prisma/dev.db',
    },
  },
});

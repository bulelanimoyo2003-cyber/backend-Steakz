import { defineConfig } from 'prisma';

export default defineConfig({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL ??
        'postgresql://postgres:postgres@localhost:5432/steakz',
    },
  },
});

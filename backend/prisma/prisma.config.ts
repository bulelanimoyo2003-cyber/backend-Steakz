import { defineConfig } from 'prisma';

export default defineConfig({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL ??
        'postgresql://postgres:password@localhost:5432/steakz_db',
    },
  },
});

# Steakz Deployment Notes

## Deployment direction

- Backend: existing TypeScript application in `backend/`
- Database: PostgreSQL
- Containerisation: Docker
- Local development: Docker Compose
- Production hosting: Render
- Frontend: deployed separately

## Work log

### 1. Backend baseline

- Installed dependencies with `npm ci`.
- Ran the existing backend build successfully.
- Prisma Client generation and TypeScript compilation passed.
- Noted 10 npm audit vulnerabilities. These require investigation; no automatic dependency upgrades have been applied.

### 2. PostgreSQL migration foundation

**Problem:** The existing Prisma migration history was created for SQLite, while the selected backend schema uses PostgreSQL.

**Resolution:**
- Preserved the original migrations in `backend/prisma/migrations_sqlite_archive/`.
- Created a fresh PostgreSQL migration directory.
- Generated the initial migration SQL from `backend/prisma/schema.prisma` using Prisma's schema diff.
- Added the PostgreSQL migration provider lock file.

**Validation:**
- `prisma validate` passed using a temporary DATABASE_URL.
- `npm run build` passed using the same temporary DATABASE_URL.
- No real database was connected or modified.

**Important:** The archived SQLite migrations must not be applied to PostgreSQL. The separate PostgreSQL SQL migration found in the repository is not a substitute for a clean initial database migration.

## Pending work

- Review and test the initial migration against a fresh PostgreSQL database.
- Configure Dockerfile and Docker Compose.
- Verify backend startup and health endpoint.
- Configure Render PostgreSQL and backend deployment.
- Configure frontend deployment and production CORS.
- Review environment variables and secrets.
- Investigate npm audit vulnerabilities.
- Run application-level tests and verify existing functionality.

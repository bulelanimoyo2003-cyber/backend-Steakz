# Local Steakz development

The local application is this checkout at `C:\Users\DELL\Downloads\Steakz`, on branch `main`. Its frontend uses the root SQLite API in `src/`, not the separate PostgreSQL API in `backend/`. The Vite proxy sends `/api` requests to `http://localhost:3001`.

The existing ignored `.env` uses `C:\Users\DELL\Downloads\Steakz\backend\prisma\dev.db`. Keep using that file for this checkout; do not override `DATABASE_URL` in the terminal or replace `.env` with `.env.example`. The database file is intentionally untracked and must stay local. The nested `backend/` project is a separate PostgreSQL application.

To reopen the same workspace, run `code -n "C:\Users\DELL\Downloads\Steakz"` and verify `git branch --show-current` prints `main` before editing.

## Start the local presentation app on Windows

Open two PowerShell terminals from this project folder. These commands load the existing `.env` database configuration and do not require changing PowerShell's execution policy.

Backend terminal:

```powershell
cd "C:\Users\DELL\Downloads\Steakz"
npm.cmd run dev
```

Frontend terminal:

```powershell
cd "C:\Users\DELL\Downloads\Steakz\frontend"
npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open <http://127.0.0.1:5173>. The API health check is <http://localhost:3001/api/health>. The frontend's Vite proxy targets port 3001.

For a fresh checkout, copy `.env.example` to `.env` and keep `DATABASE_URL` pointed at a local SQLite file. Do not copy the example over an existing `.env` or use the PostgreSQL URL configured for the separate `backend/` project.

## Presentation account setup

Startup does not seed or modify existing database records. For an intentionally fresh local database only, apply the root SQLite migrations and explicitly run the seed command:

```powershell
cd "C:\Users\DELL\Downloads\Steakz"
npx.cmd prisma migrate deploy --schema prisma/schema.prisma
npm.cmd run db:seed
```

Do not run the seed command against an existing database: it adds sample data and synchronizes the configured active branches. Presentation account setup scripts are also explicit one-time operations. Run them only when intentionally setting up those accounts:

```powershell
npm.cmd run setup:presentation:delivery
npm.cmd run setup:presentation:passwords
```

The account password update requires `STEAKZ_PRESENTATION_PASSWORD_UPDATE=true`, refuses production mode and non-presentation database paths, and is intended to be run explicitly once. Do not add setup, seed, or cleanup commands to application startup.

## Environment variables

The root SQLite API reads `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PORT`, and `FRONTEND_URL`. The frontend uses `VITE_API_URL` for production builds; during Vite development it uses the relative `/api` path and the proxy in `frontend/vite.config.ts`.

The nested `backend/` project has its own PostgreSQL Prisma schema and `.env`. It is not the local SQLite presentation API; only start it when deliberately configuring a local PostgreSQL database.

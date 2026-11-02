# Local Steakz development

The local presentation frontend uses the root SQLite API in `src/`, not the separate PostgreSQL API in `backend/`. The Vite proxy sends `/api` requests to `http://localhost:3001`. Keep the presentation database local; do not point either app at production data while testing.

## Start the local presentation app on Windows

Use two PowerShell terminals. These commands use the confirmed local presentation database and do not require changing PowerShell's execution policy.

Backend terminal:

```powershell
cd "C:\Users\DELL\Downloads\Steakz"
$env:DATABASE_URL = "file:$($env:LOCALAPPDATA -replace '\\','/')/Steakz/delivery-preview/steakz-preview-20261101-133115.db"
npm.cmd run dev
```

Frontend terminal:

```powershell
cd "C:\Users\DELL\Downloads\Steakz\frontend"
npm.cmd run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

Open <http://127.0.0.1:5174>. The API health check is <http://localhost:3001/api/health>. The frontend's Vite proxy targets port 3001.

If the presentation database filename differs on another machine, set `DATABASE_URL` to that machine's local SQLite presentation file instead. Do not use the remote PostgreSQL URL configured for the separate `backend/` project.

## Presentation account setup

For a fresh local presentation database, set `DATABASE_URL` to the local SQLite file in the same terminal before running setup commands. Apply the root SQLite migrations and start the root API once so its development seed creates the basic demo records:

```powershell
npx.cmd prisma migrate deploy --schema prisma/schema.prisma
npm.cmd run dev
```

Then stop that API process and run:

```powershell
npm.cmd run setup:presentation:delivery
npm.cmd run setup:presentation:passwords
```

The account password update requires `STEAKZ_PRESENTATION_PASSWORD_UPDATE=true`, refuses production mode and non-presentation database paths, and is intended to be run explicitly once. Do not add it to application startup.

## Environment variables

The root SQLite API reads `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PORT`, and `FRONTEND_URL`. The frontend uses `VITE_API_URL` for production builds; during Vite development it uses the relative `/api` path and the proxy in `frontend/vite.config.ts`.

The nested `backend/` project has its own PostgreSQL Prisma schema and `.env`. It is not the local SQLite presentation API; only start it when deliberately configuring a local PostgreSQL database.

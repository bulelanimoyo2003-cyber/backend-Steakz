# Steakz Restaurant Application

## Local presentation application

This checkout contains two separate APIs:

- The supported school-project app uses `frontend/`, the root `src/` Express API, and SQLite at `backend\prisma\dev.db`. The root `.env` must point to that persistent file.
- `backend/` is a separate PostgreSQL API with its own schema, environment, migrations, and generated Prisma client. It is not started by the local launcher and has not been tested against a native PostgreSQL server or any hosted database.

Start the local app from the repository root in PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\start-steakz.ps1
```

Open <http://127.0.0.1:5173>. The API health check is <http://127.0.0.1:3001/api/health>. Keep both service consoles running while demonstrating the app. Closing them stops the servers; saved source files and the persistent SQLite database remain on disk. The launcher refuses a missing or unexpected database and does not seed or reset data.

## Environment, migrations, and demo setup

Keep `.env` files private. The root API needs a private `JWT_SECRET`; `.env.example` contains only the local SQLite URL template. Do not copy the nested PostgreSQL `.env` into the root project.

For a deliberately fresh SQLite database only, apply root migrations and seed explicitly:

```powershell
npx.cmd prisma migrate deploy --schema prisma\schema.prisma
npm.cmd run db:seed
```

Never run these commands against the existing presentation database. To set local presentation account passwords, first make and verify a database backup, then run the guarded one-time setup described in [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md). Normal startup never changes account passwords.

The PostgreSQL API has an additive migration at `backend\prisma\migrations\20261103180000_delivery_checkout_designations`. Applying it requires a deliberately configured PostgreSQL `DATABASE_URL`; it was not applied to the hosted database.

## Tests and safe data recovery

Run root API tests with `npm.cmd test`, root build with `npm.cmd run build`, and the frontend type-check/build with `Set-Location frontend; npm.cmd run build`. End-to-end tests use isolated temporary SQLite databases; the delivery test additionally requires `$env:STEAKZ_TEST_DATABASE = 'true'`.

The presentation database contains account and order data and is excluded from Git. Keep verified SQLite backups outside the repository. Follow [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) for consistent `VACUUM INTO` backups and verified restoration. GitHub stores committed code; account passwords, orders, bookings, and delivery assignments are database records and need their own backup.

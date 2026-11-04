# Local Steakz presentation app

The presentation app is this checkout at `C:\Users\DELL\Downloads\Steakz`, branch `main`. Its frontend proxies `/api` to the root SQLite API in `src/` on port 3001. The root `.env` points to the persistent local database at `C:\Users\DELL\Downloads\Steakz\backend\prisma\dev.db`. That file is intentionally untracked and must stay local.

The nested `backend/` directory is a separate PostgreSQL application with its own `.env`, Prisma schema, and generated client. Both API projects have used port 3001, so starting the nested backend instead of the root API can make the same frontend appear to use another database. Do not use the nested backend for local presentation work. The root and frontend development servers do not seed, reset, or clean the database on startup.

The local AppData delivery-preview SQLite files are preserved snapshots, not the live presentation database. They contain different account, branch-assignment, and order records; do not copy one over the project database. Explicit setup commands are guarded to modify only the root project database.

## Reopen and start the same app

Open the correct workspace and branch:

```powershell
code -n "C:\Users\DELL\Downloads\Steakz"
cd "C:\Users\DELL\Downloads\Steakz"
git branch --show-current
```

The branch should be `main`. Start both services from the project root with one command:

```powershell
cd "C:\Users\DELL\Downloads\Steakz"
npm run dev
```

The root `dev` script runs the checked-in launcher. The launcher resolves the root `.env` database URL and verifies it points to this checkout's canonical database, refuses to create a missing database, checks that ports 3001 and 5173 are free, starts the root API and Vite frontend in separate PowerShell consoles, and verifies that the listeners belong to those launched processes. The API console runs `dev:api` so it cannot recursively invoke the full app launcher. It clears inherited database/port overrides in the child consoles so the root `.env` is used. It never silently switches to another port if one is occupied. Open <http://127.0.0.1:5173>; check the API at <http://127.0.0.1:3001/api/health>. Leave both service consoles running while using the app.

If the app is already running after reopening VS Code, open the URL above instead of starting a second copy. To restart it, press Ctrl+C in both service consoles and wait for ports 3001 and 5173 to be released, then rerun the launcher. If a port is reported occupied, inspect the listed PID before stopping anything. Do not start the app on Vite's fallback port 5174; the supported URL is always `http://127.0.0.1:5173`.

For a fresh checkout only, copy `.env.example` to `.env`. Its relative SQLite URL resolves to the canonical `backend\prisma\dev.db` from `prisma\schema.prisma`. Do not copy the example over an existing `.env` or use the nested PostgreSQL URL.

The API refuses to start without `JWT_SECRET`. Generate a local secret without sharing or committing it:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Set the generated value only in the local root `.env`; never commit `.env` or paste the secret into logs or chat.

## Explicit database setup only

Normal startup has no seed, reset, cleanup, account creation, or password-update step. For a deliberately fresh database only, migrations and seeding remain separate, explicit commands:

```powershell
npx.cmd prisma migrate deploy --schema prisma/schema.prisma
npm.cmd run db:seed
```

Do not run these commands against this existing presentation database: the seed synchronizes branch activity and adds sample records. Presentation driver setup and password updates are also explicit one-time commands; back up the database before using them:

```powershell
$env:STEAKZ_PRESENTATION_SETUP = "true"
npm.cmd run setup:presentation:delivery
Remove-Item Env:STEAKZ_PRESENTATION_SETUP

$env:STEAKZ_PRESENTATION_PASSWORD_UPDATE = "true"
npm.cmd run setup:presentation:passwords
Remove-Item Env:STEAKZ_PRESENTATION_PASSWORD_UPDATE
```

The driver setup creates or repairs only the four configured branch drivers, designates them for their corresponding active branches, and assigns only eligible, currently unassigned delivery orders. The password command is a separate, one-time presentation operation: it bcrypt-hashes `1234` and updates every existing user account in the local database, across all roles, without changing emails, roles, active status, or branch assignments. It first verifies that the seven expected role types, four active branches, and four active branch-specific drivers exist. Back up the database before explicitly running it. Both commands load the root `.env` and refuse any database path except this checkout's persistent project database; they are never part of startup.

On another local presentation checkout, first preserve that checkout's database and configure its root `.env` to the checkout's existing absolute `backend\prisma\dev.db` path. Run the password command from that checkout's root with `STEAKZ_PRESENTATION_PASSWORD_UPDATE=true` only when intentionally applying presentation credentials there. The command refuses production mode, missing required presentation records, and any other database path. Database accounts and password hashes are local data; Git push transfers code and the explicit setup procedure, not database changes.

Delivery orders are automatically assigned to the active designated driver for the selected branch. The root SQLite application implements and passes isolated workflow tests. The nested PostgreSQL source now contains corresponding checkout, booking, pickup, delivery, and receipt changes with an additive migration, but no native PostgreSQL server is available for integration testing; the local presentation launcher must continue to use SQLite.

## Dine-in booking eligibility

Dine-in checkout requires the signed-in customer to select their own `CONFIRMED` booking at the selected active branch. By default, a booking is eligible from 60 minutes before its reservation time through 240 minutes after it; the interval is inclusive. These limits are configured with `DINE_IN_BOOKING_EARLY_WINDOW_MINUTES` and `DINE_IN_BOOKING_DURATION_MINUTES` in the root environment. The early window may be zero; duration must be a positive whole number. Invalid values stop checkout rather than being silently ignored.

The customer menu requests eligible bookings from the API and requires an explicit selection. The API independently checks ownership, booking status, branch, active location, and current time, then repeats the eligibility check inside the order transaction. Multiple dine-in orders are allowed during one still-confirmed visit; creating an order does not complete or alter the booking. Collection and delivery do not require a booking. Delivery still requires an eligible designated driver and driver pickup still requires both cashier-confirmed payment and kitchen completion.

## Environment variables

The root SQLite API reads its configuration from the root `.env`. The frontend uses relative `/api` requests during development and the proxy in `frontend/vite.config.ts`. The nested `backend/` project reads a separate PostgreSQL configuration and must not be started for the local presentation app.

## Database backup and restore

The presentation database is `backend\prisma\dev.db`. Backups contain account data and password hashes: keep them local, outside the repository, and do not upload them to GitHub. Never restore over the live database while either service is running.

To create a consistent SQLite snapshot, run this from the project root. It uses SQLite's `VACUUM INTO`, refuses to overwrite an existing backup, and stores the snapshot outside the repository:

```powershell
$backup = Join-Path $env:USERPROFILE "Downloads\Steakz-backups\dev.db.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').sqlite"
if (Test-Path -LiteralPath $backup) { throw "Backup already exists: $backup" }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $backup) | Out-Null
$env:STEAKZ_DB_BACKUP = $backup
@'
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { DatabaseSync } from 'node:sqlite';

const destination = process.env.STEAKZ_DB_BACKUP;
if (!destination) throw new Error('STEAKZ_DB_BACKUP is required.');
const escaped = destination.replace(/\\/g, '/').replace(/'/g, "''");
const prisma = new PrismaClient();
try {
  await prisma.$executeRawUnsafe(`VACUUM INTO '${escaped}'`);
} finally {
  await prisma.$disconnect();
}
const backup = new DatabaseSync(destination, { readOnly: true });
try {
  const check = backup.prepare('PRAGMA integrity_check').get();
  if (check.integrity_check !== 'ok') throw new Error('Database integrity check failed.');
} finally {
  backup.close();
}
'@ | node --input-type=module
$exitCode = $LASTEXITCODE
Remove-Item Env:STEAKZ_DB_BACKUP
if ($exitCode -ne 0) { throw "Database backup failed with exit code $exitCode." }
Write-Output "Verified database backup: $backup"
```

To restore a chosen backup, first stop the API and frontend consoles. Confirm the backup path explicitly, preserve the current database under a new name, then replace the live file and verify its integrity:

```powershell
$backup = Read-Host "Enter the full path to the verified .sqlite backup"
$database = Join-Path $PWD 'backend\prisma\dev.db'
if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) { throw "Backup not found: $backup" }
if (-not (Test-Path -LiteralPath $database -PathType Leaf)) { throw "Live database not found: $database" }
$safetyCopy = "$database.pre-restore-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
if (Test-Path -LiteralPath $safetyCopy) { throw "Safety copy already exists: $safetyCopy" }
$replacedCopy = "$database.replaced-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
if (Test-Path -LiteralPath $replacedCopy) { throw "Replaced database copy already exists: $replacedCopy" }
$restoreCopy = "$database.restore-tmp"
if (Test-Path -LiteralPath $restoreCopy) { throw "Restore temporary file already exists: $restoreCopy" }
Copy-Item -LiteralPath $database -Destination $safetyCopy
Copy-Item -LiteralPath $backup -Destination $restoreCopy
if ((Get-FileHash -LiteralPath $backup).Hash -ne (Get-FileHash -LiteralPath $restoreCopy).Hash) {
  throw "The restore copy does not match the selected backup; the live database was not replaced."
}
Move-Item -LiteralPath $database -Destination $replacedCopy
Move-Item -LiteralPath $restoreCopy -Destination $database
$env:STEAKZ_RESTORE_DB = $database
@'
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(process.env.STEAKZ_RESTORE_DB, { readOnly: true });
try {
  const check = db.prepare('PRAGMA integrity_check').get();
  if (check.integrity_check !== 'ok') throw new Error('Restored database integrity check failed.');
  console.log('Restored database integrity:', check.integrity_check);
} finally {
  db.close();
}
'@ | node --input-type=module
$exitCode = $LASTEXITCODE
Remove-Item Env:STEAKZ_RESTORE_DB
if ($exitCode -ne 0) { throw "Restore verification failed with exit code $exitCode; keep the safety copies." }
Write-Output "Restored $database. Safety copy: $safetyCopy"
```

Keep both the pre-restore safety copy and replaced file until the restored app has been checked. Start the app only with `start-steakz.ps1`; it will refuse to create a missing database or switch to another path. The current database and all backup files are excluded from Git.

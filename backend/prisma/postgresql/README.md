# PostgreSQL deployment migration

The migration in this directory is PostgreSQL-specific. The existing
`backend/prisma/migrations` history is SQLite-specific and must not be used
against PostgreSQL.

The script resolves locations by exact branch names and resolves the selected
manager by email and role. It preserves branch, user, order, booking, and
assignment records; it adds delivery/checkout columns and manager assignment
rows, activates the four requested branches, and deactivates the rest.

Before applying it to any database, confirm the `DATABASE_URL` points to an
isolated PostgreSQL test database. Run once with:

```powershell
$env:DATABASE_URL = "<isolated-postgresql-test-url>"
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f .\prisma\postgresql\20261103090000_delivery_branches_checkout.sql
npm run prisma:generate
npm run build
```

The migration intentionally fails before changing data if one of the four
branch names or the selected manager (`steakz.city.centre.manager@steakz.com`,
role `BRANCH_MANAGER`) is missing. Do not run this script against production
as part of local development. The production database requires separate
approval and a verified backup.

For the nested PostgreSQL backend, build and start from this directory with
`npm run build` and `npm start`. Do not run the root SQLite API migrations or
seed scripts against PostgreSQL.

## Render service configuration

The repository does not track a Render blueprint, so configure the existing
services in the Render dashboard:

- Backend service root directory: `backend`
- Backend build command: `npm ci && npm run build`
- Backend start command: `npm start`
- Backend environment: `NODE_ENV=production`, `DATABASE_URL` set to the
  intended PostgreSQL database, `JWT_SECRET` set as a Render secret, and
  `FRONTEND_URL` set to the frontend service's exact HTTPS origin.
- Frontend static-site root directory: `frontend`
- Frontend build command: `npm ci && npm run build`
- Frontend publish directory: `dist`
- Frontend environment variable: `VITE_API_URL=https://steakz-backend-i50g.onrender.com`

The backend health URL `https://steakz-backend-i50g.onrender.com/api/health`
was verified to return HTTP 200. The older `i5qe` host returned HTTP 404.
Because Vite embeds `VITE_API_URL` in the static build, changing it requires
rebuilding and redeploying the frontend static site.

Do not apply the PostgreSQL data migration until the target database is
confirmed, backed up, and separately approved. The local migration and tests
do not change the hosted database.

After applying the migration to a disposable local PostgreSQL database and
starting the backend against that same database, run the workflow regression
suite from `backend`:

```powershell
$env:STEAKZ_TEST_DATABASE = "true"
$env:API_URL = "http://127.0.0.1:3002"
npm run test:e2e:postgresql
```

The test runner refuses non-loopback database and API hosts. It removes its
own fixture users, orders, bookings, tables, and menu items on completion.

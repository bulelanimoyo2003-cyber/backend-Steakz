# Steakz Deployment Notes

## Deployment architecture

- Backend: TypeScript application in `backend/`
- Database: PostgreSQL 16
- ORM: Prisma 6
- Containerisation: Docker
- Local deployment: Docker Compose
- Production hosting: Render
- Frontend: deployed separately

## 1. Backend baseline

- Installed dependencies with `npm ci`.
- Confirmed Prisma Client generation and TypeScript compilation.
- Backend build completed successfully.
- Recorded 10 npm audit vulnerabilities for later investigation.
- No automatic dependency upgrades were applied.

## 2. PostgreSQL migration foundation

The original Prisma migration history was SQLite-specific.

Resolution:
- Preserved the SQLite migrations in `backend/prisma/migrations_sqlite_archive/`.
- Created a fresh PostgreSQL migration directory.
- Generated the initial migration from `backend/prisma/schema.prisma`.
- Added the PostgreSQL migration provider lock file.

The initial PostgreSQL migration was successfully applied to the local Docker database.

The archived SQLite migrations must not be applied to PostgreSQL. The separate PostgreSQL SQL migration already present in the repository is not a replacement for the clean initial migration.

## 3. Docker configuration

Files:
- `docker-compose.yml`
- `backend/Dockerfile`
- `backend/.dockerignore`

The Compose stack contains:
- PostgreSQL 16 with persistent volume storage.
- The Steakz backend.
- A PostgreSQL health check.
- Backend startup dependent on database health.

Local ports:
- Backend: `3001`
- PostgreSQL host port: `5433`
- PostgreSQL container port: `5432`

The host database port is mapped to `5433` to avoid conflict with an existing local PostgreSQL service. The backend connects to PostgreSQL internally using the Docker service hostname `db` and port `5432`.

The Docker image uses Node.js 22 and installs OpenSSL in both build and runtime stages.

The Prisma native query engine is copied into the compiled output by `backend/scripts/prepare-generated-client.cjs`.

The container runs `prisma migrate deploy` before starting the backend.

## 4. Local environment

Create `backend/.env` using `backend/.env.example` as a reference.

Required local settings include:
- `PORT`
- `NODE_ENV`
- `DATABASE_URL`
- `DATABASE_URL_DOCKER`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `JWT_SECRET`
- `FRONTEND_URL`

Do not commit `.env` files or production secrets.

When running Compose from the repository root:

`docker compose --env-file backend/.env up -d`

When running Compose from the backend directory:

`docker compose --env-file .env up -d`

## 5. Local deployment verification

Verified:
- Docker backend image builds successfully.
- PostgreSQL container starts and passes its health check.
- Prisma connects to the PostgreSQL database.
- Initial migration is applied successfully.
- Backend starts on port `3001`.
- `GET /api/health` returns HTTP `200 OK` with a JSON status of `ok`.

The root `/` endpoint currently returns HTTP `404`; the health endpoint is `/api/health`.

## 6. Application-level testing

The PostgreSQL delivery end-to-end test script has been inspected but not executed.

It requires:
- `STEAKZ_TEST_DATABASE=true`
- A loopback PostgreSQL connection.
- A loopback API URL.
- A JWT secret.
- Pre-existing active and inactive branch fixtures and a specific branch manager assignment.

The test creates temporary users, menu items, tables, bookings and orders, and includes cleanup logic. It must only run against an isolated test database with the required fixtures.

## 7. Remaining work

- Review the end-to-end test prerequisites and arrange a safe isolated test database.
- Verify the backend environment example and local configuration.
- Review and commit the Docker deployment changes.
- Configure Render PostgreSQL.
- Configure the Render backend service and production environment variables.
- Configure the health check path as `/api/health`.
- Deploy the frontend separately and configure production CORS.
- Investigate the recorded npm audit vulnerabilities.
- Perform production smoke tests.

## Customer payment setup (test mode)

The customer checkout supports cash at the selected branch's cashier and
Stripe-hosted card checkout in test mode. Card entry remains on Stripe Checkout.
No live Stripe key is accepted by the application.

Configure these **backend service** environment variables in Render:

- `STRIPE_SECRET_KEY`: Stripe test secret key (`sk_test_...`).
- `STRIPE_WEBHOOK_SECRET`: signing secret (`whsec_...`) for the production
  Render webhook endpoint configured in Stripe test mode.
- `FRONTEND_URL`: exact deployed frontend HTTPS origin (also used for Checkout
  return links).

Do not set either Stripe key on the frontend/static site. Keep both out of logs,
Git, and support tickets. The customer checkout offers the card option only
when both Stripe settings are configured. Enable the **Card** payment method
for the account in Stripe Dashboard (test mode).

Configure a Stripe webhook destination pointing to:

`https://<Render-backend-host>/api/payments/stripe/webhook`

Subscribe to `checkout.session.completed`,
`checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `checkout.session.expired`,
`payment_intent.succeeded`, and `payment_intent.payment_failed`. Copy the
endpoint's signing secret to `STRIPE_WEBHOOK_SECRET`. Stripe's signed event,
order reference, attempt ID, amount, and currency are validated server-side;
the success redirect does not record payment.

### PostgreSQL deployment migration

The additive migration is
`backend/prisma/migrations/20261109190000_add_customer_payments/migration.sql`.
Before deploying, take and verify a Render PostgreSQL backup and confirm the
existing database migration history matches this repository's PostgreSQL
migration baseline. Deploy with the backend service build/start commands already
documented above; `backend/Dockerfile` runs `prisma migrate deploy` before
starting the server. For a non-Docker Render service, run
`npx prisma migrate deploy --schema prisma/schema.prisma` from the backend
service root as a pre-deploy step (or from a one-off shell after the verified
backup). Do not run the SQLite migration against PostgreSQL, and do not reset or
seed the database. Verify existing orders, bookings, accounts, and payment
states after migration.

The canonical local SQLite database was backed up before applying the additive
SQLite migration. Existing local startup commands remain unchanged. For a
fresh local checkout only, apply the root SQLite migrations before explicitly
seeding; never seed an existing database.

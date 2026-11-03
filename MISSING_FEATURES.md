# Current implementation audit

The local school-project application is implemented in root `src/` and `frontend/` and uses SQLite. The nested `backend/` directory is a separate PostgreSQL application, not the API used by the local presentation launcher.

## Verified implementation and repairs

- Seven roles are supported with current-account JWT checks and backend role/branch authorization.
- The presentation database has four active branches, three retained inactive branches, and 15 menu items per active branch. The City Centre manager is assigned to all four active locations.
- The root SQLite order flow validates confirmed customer-owned bookings for dine-in, assigns deliveries to the selected branch's designated driver, requires both paid and prepared status for pickup, and records driver completion.
- All 30 existing presentation accounts were assigned bcrypt hashes of `1234` through a guarded one-time script after the database backup was verified. The API does not perform password resets or seeding at startup.
- Root configuration and the supported launcher resolve the persistent database consistently and require an explicit JWT secret.
- Browser verification covered customer registration/login on a disposable database, every role dashboard, branch switching, all public branches and menus, and the SPA route fallback.
- Root unit/build and isolated SQLite end-to-end branch, manager, isolation, booking, and delivery workflow checks passed.
- The nested PostgreSQL source was repaired for automatic driver assignment, booking eligibility, atomic pickup, delivery completion, payment timestamp, and receipt tracking. It builds, passes Prisma schema validation, and its workflow unit tests pass.

## Remaining and blocked items

- Native PostgreSQL database integration and migration execution are blocked by the lack of local PostgreSQL, Docker, or `psql`. The hosted database was not contacted or modified; no hosted deployment is claimed verified.
- Existing menus were not altered, but no approved source was available to confirm their names, descriptions, or branch-specific prices. Owner confirmation is needed.
- UI testing did not create or alter presentation orders. Delivery, booking, payment, and kitchen state transitions were exercised against isolated SQLite test databases.
- The full account email/role/branch and login verification results are stored in the private verification report outside the Git repository; account data is not committed.

See [README.md](./README.md), [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md), [IMPLEMENTATION_REPORT.md](./IMPLEMENTATION_REPORT.md), and [TESTING_CHECKLIST.md](./TESTING_CHECKLIST.md) for running, backup, and verification details.

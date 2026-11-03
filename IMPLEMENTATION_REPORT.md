# Steakz implementation report

## Application layout

- `frontend/` is the React/Vite application.
- Root `src/` is the local Express API used by the school-project presentation app.
- The local API uses Prisma with the persistent SQLite file `backend/prisma/dev.db`.
- `backend/` is a separate PostgreSQL API with its own schema, configuration, migration history, and generated client. The local launcher does not start it.

## Repairs and verification

- All 30 retained local presentation accounts now use bcrypt-hashed password `1234`; the guarded one-time script does not run during normal startup.
- The root environment and Prisma defaults target one canonical SQLite file. The supported launcher rejects missing or unexpected database paths and never seeds or resets the presentation database.
- All seven roles passed normal login endpoint checks and role-specific dashboard API checks. Browser checks passed for all seven dashboards, four public branches and their menus, manager all-location view and branch switching, registration/login on a disposable database, and direct SPA route serving.
- Root API unit tests/build, frontend TypeScript/production build, and isolated active-branch, manager, branch-isolation, booking, and delivery workflow tests passed.
- The separate PostgreSQL source now includes additive designation and payment-timestamp migrations, atomic automatic driver assignment at checkout, confirmed-booking checks, paid-and-prepared pickup gates, driver-only delivery completion, and customer receipt tracking fields. Its build, Prisma schema validation, and workflow unit tests passed.
- A dated source archive and a SQLite snapshot were created outside the repository. The snapshot was restored to a separate SQLite file and verified with integrity, foreign-key, and Prisma read checks before presentation accounts were changed.

See [README.md](./README.md) for the application layout and startup commands, [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) for safe backup/restore steps, and [TESTING_CHECKLIST.md](./TESTING_CHECKLIST.md) for repeatable test commands.

## Remaining limitations

- Native PostgreSQL integration and migration execution remain untested because no local PostgreSQL server, Docker, or `psql` is available. The hosted database was not contacted or changed; source compilation and schema validation do not prove database integration.
- Menus for all four active locations were displayed, but no approved source was available to validate names, descriptions, or prices. Existing records were preserved and need owner confirmation.
- Browser UI work did not create or alter presentation orders. Delivery, booking, payment, kitchen, and status-transition coverage comes from isolated SQLite end-to-end tests, not from changing live presentation records.
- No production deployment was modified or verified.

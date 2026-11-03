# Current implementation status

The current application and test status is maintained in [IMPLEMENTATION_REPORT.md](./IMPLEMENTATION_REPORT.md), [MISSING_FEATURES.md](./MISSING_FEATURES.md), and [TESTING_CHECKLIST.md](./TESTING_CHECKLIST.md).

The previous contents of this file described an earlier application state and included incorrect claims about automatic migrations, frontend-only delivery gates, and unimplemented dashboards. Do not use those old instructions or sample credentials.

The supported local school-project configuration is the root `src/` API, `frontend/`, and the SQLite database at `backend/prisma/dev.db`. Startup and backup/restore instructions are in [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md).

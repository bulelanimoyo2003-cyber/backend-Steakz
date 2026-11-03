# Steakz testing checklist

## Local presentation setup

- [ ] Use the repository root as the working directory.
- [ ] Configure the root `.env` for SQLite at this checkout's `backend\prisma\dev.db` and set a private `JWT_SECRET`.
- [ ] Run the local SQLite API from the root and the Vite frontend from `frontend/`; do not start the separate PostgreSQL app in `backend/`.
- [ ] Check `http://127.0.0.1:3001/api/health` and `http://127.0.0.1:5173`.
- [ ] Back up the project database before intentionally changing presentation records. Follow [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md).

## Build and automated tests

From the project root:

```powershell
npm.cmd test
npm.cmd run build
Set-Location frontend
npm.cmd run build
Set-Location ..
```

The backend workflow tests use isolated temporary SQLite databases. The delivery workflow test is explicitly guarded:

```powershell
$env:STEAKZ_TEST_DATABASE = 'true'
npm.cmd run test:e2e:delivery:sqlite
Remove-Item Env:STEAKZ_TEST_DATABASE
```

Other root end-to-end scripts use the isolated API test harness:

```powershell
npm.cmd run test:e2e:branches
npm.cmd run test:e2e:manager
npm.cmd run test:e2e:isolation
```

Do not set test `DATABASE_URL` values to the presentation database. Do not run `npm run db:seed` against the presentation database; seeding is only for deliberately fresh databases.

## Authentication and roles

- [ ] Register a new customer and sign in; confirm the role is `CUSTOMER`.
- [ ] Verify `ADMIN` and `HQ_MANAGER` can access only their authorized administrative/overview routes.
- [ ] Verify `BRANCH_MANAGER` can select an assigned branch, see the all-assigned-locations summary, and cannot access an unassigned branch.
- [ ] Verify `CHEF` and `CASHIER` only access their assigned branch's orders.
- [ ] Verify `DELIVERY_DRIVER` only sees orders assigned to that driver.
- [ ] Verify a disabled account cannot sign in and a deleted/inactive account's old JWT is rejected.
- [ ] Verify changing a user's database role or branch takes effect on the next authenticated request.

## Branches, menu, and persistence

- [ ] Confirm the public location list contains only City Centre, Northside, Southgate, and Uptown.
- [ ] Confirm inactive branches and their historical records remain retained.
- [ ] Confirm menus load for each active branch and contain that branch's items.
- [ ] Confirm the shared branch manager is assigned to all four active locations.
- [ ] Restart the root API and verify accounts, orders, assignments, and menu data remain in the same SQLite database.

## Ordering, booking, payment, and delivery

- [ ] Reject dine-in checkout without a booking, with another customer's booking, with a different branch's booking, and with an unconfirmed/expired booking.
- [ ] Accept an eligible confirmed booking that belongs to the customer and selected branch.
- [ ] Accept collection and delivery checkout without a booking.
- [ ] Confirm delivery orders are assigned to the designated active driver for their selected branch and that assignment persists.
- [ ] Confirm pickup is rejected until both the kitchen marks the order done and the cashier marks it paid.
- [ ] Confirm the assigned driver can collect and mark the order delivered, but cannot mark it delivered before pickup.
- [ ] Confirm delivery does not change payment status and the customer dashboard shows delivery progress.
- [ ] Confirm dashboards refresh order status without mixing branches or customers.

## Manual frontend demonstration

- [ ] Verify login, registration, menus, branches, booking, customer dashboard, and each staff dashboard.
- [ ] Refresh a nested route directly and confirm it returns the intended page rather than a 404.
- [ ] Check browser console/network errors and verify the frontend API requests use the local Vite proxy.
- [ ] Demonstrate the branch manager's all-location view and switch to a single assigned branch.

# Steakz Testing Checklist

## Setup
- [ ] Confirm `.env` is created from `.env.example` with valid values.
- [ ] Confirm PostgreSQL database is available and `DATABASE_URL` is correct.
- [ ] Run `npm install` in both `backend/` and `frontend/`.
- [ ] Run `npm run build` in both `backend/` and `frontend/` successfully.

## Backend
- [ ] Start backend dev server with `npm run dev`.
- [ ] Verify `backend/src/lib/seed.ts` seed runs without errors.
- [ ] Confirm API responds on `http://localhost:3001/api/public/menu`.
- [ ] Confirm auth login returns JWT for valid credentials.
- [ ] Confirm role-protected endpoints reject unauthorized access.
- [ ] Confirm admin routes require `ADMIN` role and can manage users and locations.

## Isolated Automated Tests
- [ ] Run `npm test` for backend unit tests.
- [ ] Confirm the only active customer locations are City Centre (ID 1), Northside (ID 2), Southgate (ID 3), and Uptown (ID 7).
- [ ] Run `npm run test:e2e:delivery` for the complete delivery workflow at all four active branches.
- [ ] Run `npm run test:e2e:branches` to verify the exact active-location list, inactive-branch order/reservation rejection, and retained order management.
- [ ] Run `npm run test:e2e:manager` to verify the selected manager's four assignments, branch-scoped operations, and combined sales.
- [ ] Run `npm run test:e2e:isolation` to verify all 12 directed cross-branch combinations plus kitchen, cashier, reservation, receipt, customer, manager, and delivery isolation.
- [ ] HTTP test scripts under `scripts/` and `backend/scripts/` use a temporary SQLite database, migrate and seed that database, then remove it on exit.
- [ ] Do not point automated test scripts at the running application or its normal `DATABASE_URL`.

## Frontend
- [ ] Verify the landing page renders correctly.
- [ ] Verify login and registration pages function and redirect after auth.
- [ ] Verify menu page loads menu items from the API.
- [ ] Verify branches page loads branch data from the API.
- [ ] Verify 404 page appears for unknown routes.

## Authentication and Roles
- [ ] Test logging in as `CUSTOMER` and accessing `/customer` and `/book`.
- [ ] Test logging in as `CHEF` and accessing `/chef` only.
- [ ] Test logging in as `CASHIER` and accessing `/cashier` only.
- [ ] Test logging in as `BRANCH_MANAGER` and accessing `/branch-manager` only.
- [ ] Verify a multi-branch manager can switch between assigned branches and see accurate all-location totals without mixing records.
- [ ] Test logging in as `HQ_MANAGER` and accessing `/hq` only.
- [ ] Test logging in as `ADMIN` and accessing `/admin` only.
- [ ] Test logging in as `DELIVERY_DRIVER` and accessing assigned deliveries only.
- [ ] Confirm unauthorized users are redirected to `/login`.
- [ ] Confirm disabled users cannot log in.

## Admin Features
- [ ] Create a new user from the admin dashboard.
- [ ] Create a new branch location from the admin dashboard.
- [ ] Update a user role from the admin dashboard.
- [ ] Enable and disable a user account from the admin dashboard.
- [ ] Delete a user from the admin dashboard.

## Workflow Tests
- [ ] Customer can book a table from the booking page.
- [ ] Branch manager can view bookings and branch reports.
- [ ] Chef can view and update order status.
- [ ] Cashier can view settled orders and process payments.
- [ ] Branch manager assigns a same-branch driver to a delivery order.
- [ ] Chef prepares the delivery before the assigned driver can collect it.
- [ ] Driver advances the order to out-for-delivery and delivered; delivery alone does not mark it paid.
- [ ] Customer sees delivery progress and cannot access another customer's orders.
- [ ] Drivers and branch staff cannot access orders outside their assigned branch or driver scope.
- [ ] HQ manager can view branch summaries and sales data.

## Regression and Edge Cases
- [ ] Confirm menu page still loads after auth state changes.
- [ ] Confirm app does not crash when API returns errors.
- [ ] Confirm protected routes block all unauthorized access.
- [ ] Confirm data updates refresh on create/edit actions.
- [ ] Confirm the app handles missing branch or user data gracefully.
- [ ] Confirm switching locations asks before clearing the cart and stale menu responses cannot replace the selected location's menu.

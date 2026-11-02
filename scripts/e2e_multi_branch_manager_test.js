import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { withIsolatedApi } from './e2e_test_environment.js';

const expectedBranches = ['Steakz City Centre', 'Steakz Northside', 'Steakz Southgate', 'Steakz Uptown'];
const expectedBranchIds = [1, 2, 3, 7];

async function request(baseUrl, method, endpoint, body, token, branchId) {
  const response = await fetch(`${baseUrl}/api${endpoint}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(branchId ? { 'X-Branch-Id': String(branchId) } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${method} ${endpoint} returned invalid JSON (HTTP ${response.status}).`);
  }
  return { status: response.status, data };
}

async function expectStatus(baseUrl, method, endpoint, token, expectedStatus, body, branchId) {
  const result = await request(baseUrl, method, endpoint, body, token, branchId);
  assert.equal(result.status, expectedStatus, `${method} ${endpoint} response: ${JSON.stringify(result.data)}`);
  return result.data;
}

async function login(baseUrl, email, password, expectedRole) {
  const data = await expectStatus(baseUrl, 'POST', '/auth/login', undefined, 200, { email, password });
  assert.equal(data.user.role, expectedRole);
  return data;
}

await withIsolatedApi(async (baseUrl, databasePath) => {
  const nonce = `${Date.now()}-${process.pid}`;
  const db = new DatabaseSync(databasePath);
  let managerId;
  let branches;
  let originalManagerRoster;
  let originalUserRoster;

  try {
    branches = db.prepare('SELECT id,name,isActive FROM Branch ORDER BY id').all();
    const activeBranches = branches.filter((branch) => branch.isActive);
    assert.deepEqual(activeBranches.map((branch) => branch.name), expectedBranches);
    assert.deepEqual(activeBranches.map((branch) => branch.id), expectedBranchIds);
    managerId = db.prepare('SELECT id FROM User WHERE email=? AND role=?').get(
      'steakz.city.centre.manager@steakz.com',
      'BRANCH_MANAGER',
    ).id;
    originalManagerRoster = db.prepare('SELECT id,email,role,branchId FROM User WHERE role=? ORDER BY id').all('BRANCH_MANAGER');
    originalUserRoster = db.prepare('SELECT id,email,role,branchId FROM User ORDER BY id').all();

    const managerAssignments = db.prepare(
      'SELECT branchId FROM BranchManagerAssignment WHERE userId=? ORDER BY branchId',
    ).all(managerId);
    assert.deepEqual(managerAssignments.map((assignment) => assignment.branchId), activeBranches.map((branch) => branch.id));
    assert.deepEqual(
      db.prepare('SELECT id,email,role,branchId FROM User WHERE role=? ORDER BY id').all('BRANCH_MANAGER'),
      originalManagerRoster,
      'Adding branch access must preserve every manager account and legacy assignment.',
    );
    assert.deepEqual(
      db.prepare('SELECT id,email,role,branchId FROM User ORDER BY id').all(),
      originalUserRoster,
      'Manager access changes must not alter user accounts or roles.',
    );
  } finally {
    db.close();
  }

  const managerSession = await login(baseUrl, 'steakz.city.centre.manager@steakz.com', 'password123', 'BRANCH_MANAGER');
  const managerToken = managerSession.token;
  const branchList = await expectStatus(baseUrl, 'GET', '/branch-manager/branches', managerToken, 200);
  assert.deepEqual(branchList.map((branch) => branch.name), expectedBranches);
  assert.deepEqual(branchList.map((branch) => branch.id), expectedBranchIds);
  assert.deepEqual(branchList.map((branch) => branch.isActive), [true, true, true, true]);

  const customerEmail = `multi-branch-customer-${nonce}@test.invalid`;
  await expectStatus(baseUrl, 'POST', '/auth/register', undefined, 201, {
    name: 'Multi Branch Manager E2E Customer',
    email: customerEmail,
    password: 'Password123!',
  });
  const customerToken = (await login(baseUrl, customerEmail, 'Password123!', 'CUSTOMER')).token;
  const branchResults = [];
  const activeBranches = branches.filter((branch) => branch.isActive);

  await expectStatus(baseUrl, 'GET', '/branch-manager/orders', managerToken, 400);
  const inactiveBranch = branches.find((branch) => !branch.isActive);
  assert.ok(inactiveBranch);
  await expectStatus(baseUrl, 'GET', '/branch-manager/orders', managerToken, 403, undefined, inactiveBranch.id);

  for (const [index, branch] of activeBranches.entries()) {
    const configBranchId = branch.id;
    const [staff, tables, menu, drivers, bookingsBefore, ordersBefore, salesBefore] = await Promise.all([
      expectStatus(baseUrl, 'GET', '/branch-manager/staff', managerToken, 200, undefined, configBranchId),
      expectStatus(baseUrl, 'GET', '/branch-manager/tables', managerToken, 200, undefined, configBranchId),
      expectStatus(baseUrl, 'GET', '/branch-manager/menu', managerToken, 200, undefined, configBranchId),
      expectStatus(baseUrl, 'GET', `/delivery-management/drivers?branchId=${configBranchId}`, managerToken, 200, undefined, configBranchId),
      expectStatus(baseUrl, 'GET', '/branch-manager/bookings', managerToken, 200, undefined, configBranchId),
      expectStatus(baseUrl, 'GET', '/branch-manager/orders', managerToken, 200, undefined, configBranchId),
      expectStatus(baseUrl, 'GET', '/branch-manager/sales', managerToken, 200, undefined, configBranchId),
    ]);
    assert.ok(staff.every((member) => member.branchId === configBranchId || member.role === 'BRANCH_MANAGER'));
    assert.ok(tables.every((table) => table.branchId === configBranchId));
    assert.ok(menu.length > 0);
    assert.ok(drivers.every((driver) => driver.branchId === configBranchId));
    assert.ok(bookingsBefore.every((booking) => booking.table.branch.id === configBranchId));
    assert.ok(ordersBefore.every((order) => order.branchId === configBranchId && order.branch.id === configBranchId));
    assert.deepEqual(salesBefore, { totalSales: 0, orderCount: 0 });

    const menuItem = await expectStatus(baseUrl, 'POST', '/branch-manager/menu', managerToken, 201, {
      name: `Manager Branch E2E ${nonce}-${configBranchId}`,
      description: 'Isolated manager scope check',
      price: 25 + index,
      category: 'E2E',
    }, configBranchId);
    assert.equal(menuItem.branchId, configBranchId);

    const driver = await expectStatus(baseUrl, 'POST', '/branch-manager/staff/drivers', managerToken, 201, {
      name: `Manager Branch E2E Driver ${configBranchId}`,
      email: `multi-branch-driver-${configBranchId}-${nonce}@test.invalid`,
      password: 'Password123!',
    }, configBranchId);
    assert.equal(driver.branchId, configBranchId);

    const chefPrefix = branch.name.toLowerCase().replace(/\s+/g, '.');
    const chefToken = (await login(baseUrl, `${chefPrefix}.chef@steakz.com`, 'password123', 'CHEF')).token;
    const order = await expectStatus(baseUrl, 'POST', '/customer/orders', customerToken, 201, {
      orderType: 'DELIVERY',
      branchId: configBranchId,
      recipientName: 'Manager workflow recipient',
      recipientPhone: '+1 (555) 010-0200',
      deliveryAddress: `${branch.name} E2E delivery address`,
      deliveryInstructions: 'Use the side entrance',
      items: [{ menuItemId: menuItem.id, quantity: 1 }],
    });
    assert.equal(order.deliveryStatus, 'ASSIGNED');
    assert.equal(order.assignedDriverId, driver.id);
    const driverToken = (await login(baseUrl, driver.email, 'Password123!', 'DELIVERY_DRIVER')).token;
    await expectStatus(baseUrl, 'PATCH', `/driver/orders/${order.id}/pickup`, driverToken, 409);
    await expectStatus(baseUrl, 'PATCH', `/chef/orders/${order.id}/preparing`, chefToken, 200);
    await expectStatus(baseUrl, 'PATCH', `/chef/orders/${order.id}/done`, chefToken, 200);
    await expectStatus(baseUrl, 'PATCH', `/driver/orders/${order.id}/pickup`, driverToken, 200);
    const delivered = await expectStatus(baseUrl, 'PATCH', `/driver/orders/${order.id}/delivered`, driverToken, 200);
    assert.equal(delivered.deliveryStatus, 'DELIVERED');
    const customerOrders = await expectStatus(baseUrl, 'GET', '/customer/orders', customerToken, 200);
    const customerOrder = customerOrders.find((candidate) => candidate.id === order.id);
    assert.equal(customerOrder?.deliveryStatus, 'DELIVERED');
    assert.equal(customerOrder?.paymentStatus, 'UNPAID');

    const booking = await expectStatus(baseUrl, 'POST', '/customer/bookings', customerToken, 201, {
      tableId: tables[0].id,
      guestCount: 2,
      date: new Date(Date.now() + (10 + index) * 24 * 60 * 60 * 1000).toISOString(),
    });
    const confirmedBooking = await expectStatus(
      baseUrl,
      'PATCH',
      `/branch-manager/bookings/${booking.id}/status`,
      managerToken,
      200,
      { status: 'CONFIRMED' },
      configBranchId,
    );
    assert.equal(confirmedBooking.status, 'CONFIRMED');

    const scopedOrders = await expectStatus(baseUrl, 'GET', '/branch-manager/orders', managerToken, 200, undefined, configBranchId);
    assert.ok(scopedOrders.some((candidate) => candidate.id === order.id));
    assert.ok(scopedOrders.every((candidate) => candidate.branchId === configBranchId && candidate.branch.name === branch.name));
    const scopedSales = await expectStatus(baseUrl, 'GET', '/branch-manager/sales', managerToken, 200, undefined, configBranchId);
    assert.deepEqual(scopedSales, { totalSales: menuItem.price, orderCount: 1 });
    const scopedBookings = await expectStatus(baseUrl, 'GET', '/branch-manager/bookings', managerToken, 200, undefined, configBranchId);
    assert.ok(scopedBookings.some((candidate) => candidate.id === booking.id && candidate.table.branch.name === branch.name));
    const scopedMenu = await expectStatus(baseUrl, 'GET', '/branch-manager/menu', managerToken, 200, undefined, configBranchId);
    assert.ok(scopedMenu.some((candidate) => candidate.id === menuItem.id));

    const tableUpdate = await expectStatus(baseUrl, 'PATCH', `/branch-manager/tables/${tables[1].id}/status`, managerToken, 200, {
      status: 'CLEANING',
    }, configBranchId);
    assert.equal(tableUpdate.status, 'CLEANING');
    branchResults.push({ branch, menuItem, order, booking, driver });
  }

  const first = branchResults[0];
  const second = branchResults[1];
  await expectStatus(baseUrl, 'PATCH', `/branch-manager/menu/${first.menuItem.id}`, managerToken, 403, {
    isAvailable: false,
  }, second.branch.id);
  await expectStatus(baseUrl, 'PATCH', `/branch-manager/bookings/${first.booking.id}/status`, managerToken, 403, {
    status: 'CANCELLED',
  }, second.branch.id);

  const aggregate = await Promise.all(branchResults.map(({ branch }) =>
    expectStatus(baseUrl, 'GET', '/branch-manager/sales', managerToken, 200, undefined, branch.id)));
  assert.equal(aggregate.reduce((sum, result) => sum + result.totalSales, 0), branchResults.reduce((sum, item) => sum + item.menuItem.price, 0));
  assert.equal(aggregate.reduce((sum, result) => sum + result.orderCount, 0), 4);
  await expectStatus(baseUrl, 'GET', '/branch-manager/orders', (await login(
    baseUrl,
    'steakz.city.centre.chef@steakz.com',
    'password123',
    'CHEF',
  )).token, 403, undefined, branches[0].id);

  console.log('Multi-branch manager E2E passed: four assigned locations, branch-scoped management, combined sales, and same-branch deliveries.');
});

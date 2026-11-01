import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { withIsolatedApi } from './e2e_test_environment.js';

const activeBranchNames = ['Steakz City Centre', 'Steakz Northside', 'Steakz Southgate', 'Steakz Uptown'];
const activeBranchIds = [1, 2, 3, 7];
const inactiveBranchNames = ['Steakz East Quarter', 'Steakz Westfield', 'Steakz Marina Bay'];

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
  return data.token;
}

async function prepareDelivery(baseUrl, branch, tokens, menuItem, nonce) {
  const order = await expectStatus(baseUrl, 'POST', '/customer/orders', tokens.customer, 201, {
    orderType: 'DELIVERY',
    branchId: branch.id,
    recipientName: 'Branch Availability Test',
    recipientPhone: '+1 (555) 010-0101',
    deliveryAddress: `${branch.address}, test delivery`,
    items: [{ menuItemId: menuItem.id, quantity: 1 }],
  });
  assert.equal(order.paymentStatus, 'UNPAID');

  const driver = await expectStatus(baseUrl, 'POST', '/branch-manager/staff/drivers', tokens.manager, 201, {
    name: `Branch Test Driver ${branch.id}`,
    email: `branch-test-driver-${branch.id}-${nonce}@test.invalid`,
    password: 'Password123!',
  }, branch.id);
  const driverToken = await login(baseUrl, driver.email, 'Password123!', 'DELIVERY_DRIVER');
  await expectStatus(baseUrl, 'PATCH', `/delivery-management/orders/${order.id}/driver`, tokens.manager, 200, {
    driverId: driver.id,
  }, branch.id);
  return { order, driverToken };
}

async function completeDelivery(baseUrl, branch, order, tokens) {
  await expectStatus(baseUrl, 'PATCH', `/driver/orders/${order.id}/pickup`, tokens.driver, 409);
  await expectStatus(baseUrl, 'PATCH', `/chef/orders/${order.id}/preparing`, tokens.chef, 200);
  await expectStatus(baseUrl, 'PATCH', `/chef/orders/${order.id}/done`, tokens.chef, 200);
  const pickup = await expectStatus(baseUrl, 'PATCH', `/driver/orders/${order.id}/pickup`, tokens.driver, 200);
  assert.equal(pickup.deliveryStatus, 'OUT_FOR_DELIVERY');
  const delivered = await expectStatus(baseUrl, 'PATCH', `/driver/orders/${order.id}/delivered`, tokens.driver, 200);
  assert.equal(delivered.deliveryStatus, 'DELIVERED');

  const customerOrders = await expectStatus(baseUrl, 'GET', '/customer/orders', tokens.customer, 200);
  const customerOrder = customerOrders.find((candidate) => candidate.id === order.id);
  assert.equal(customerOrder?.branchId, branch.id);
  assert.equal(customerOrder?.deliveryStatus, 'DELIVERED');
  assert.equal(customerOrder?.paymentStatus, 'UNPAID');
}

await withIsolatedApi(async (baseUrl, databasePath) => {
  const nonce = `${Date.now()}-${process.pid}`;
  const initialActiveBranches = await expectStatus(baseUrl, 'GET', '/public/branches', undefined, 200);
  assert.deepEqual(initialActiveBranches.map((branch) => branch.name), activeBranchNames);
  assert.deepEqual(initialActiveBranches.map((branch) => branch.id), activeBranchIds);
  const customer = await login(baseUrl, 'customer@steakz.com', 'password123', 'CUSTOMER');
  const staffByBranch = new Map();
  const inactiveSetups = [];
  const db = new DatabaseSync(databasePath);
  let branches;
  let beforeRoster;
  let beforeAssignments;
  try {
    branches = db.prepare('SELECT id,name,address,isActive FROM Branch ORDER BY id').all();
    assert.deepEqual(
      branches.filter((branch) => branch.isActive).map((branch) => branch.name),
      activeBranchNames,
    );
    db.prepare('UPDATE Branch SET isActive=1').run();
  } finally {
    db.close();
  }
  const allBranches = await expectStatus(baseUrl, 'GET', '/public/branches', undefined, 200);
  assert.deepEqual(allBranches.map((branch) => branch.name), branches.map((branch) => branch.name));

  for (const branch of branches) {
    const prefix = branch.name.toLowerCase().replace(/\s+/g, '.');
    const tokens = {
      customer,
      manager: await login(baseUrl, `${prefix}.manager@steakz.com`, 'password123', 'BRANCH_MANAGER'),
      chef: await login(baseUrl, `${prefix}.chef@steakz.com`, 'password123', 'CHEF'),
    };
    staffByBranch.set(branch.id, tokens);

    if (!inactiveBranchNames.includes(branch.name)) continue;
    const details = await expectStatus(baseUrl, 'GET', `/public/branches/${branch.id}`, undefined, 200);
    const menu = await expectStatus(baseUrl, 'GET', `/menu/${branch.id}`, undefined, 200);
    assert.ok(details.tables.length > 1);
    assert.ok(menu.length > 0);
    const booking = await expectStatus(baseUrl, 'POST', '/customer/bookings', customer, 201, {
      tableId: details.tables[0].id,
      guestCount: 2,
      date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000 + branch.id * 60_000).toISOString(),
    });
    const delivery = await prepareDelivery(baseUrl, branch, tokens, menu[0], nonce);
    inactiveSetups.push({ branch, details, menuItem: menu[0], booking, delivery, tokens });
  }

  const statusDb = new DatabaseSync(databasePath);
  try {
    beforeRoster = statusDb.prepare('SELECT id,email,role,branchId FROM User ORDER BY id').all();
    beforeAssignments = statusDb.prepare('SELECT userId,branchId FROM BranchManagerAssignment ORDER BY userId,branchId').all();
    const deactivate = statusDb.prepare('UPDATE Branch SET isActive=0 WHERE id=? AND name=? AND isActive=1');
    for (const branch of branches.filter((candidate) => inactiveBranchNames.includes(candidate.name))) {
      assert.equal(deactivate.run(branch.id, branch.name).changes, 1);
    }

    const activeCount = statusDb.prepare('SELECT COUNT(*) AS count FROM Branch WHERE isActive=1').get().count;
    const afterRoster = statusDb.prepare('SELECT id,email,role,branchId FROM User ORDER BY id').all();
    const afterAssignments = statusDb.prepare('SELECT userId,branchId FROM BranchManagerAssignment ORDER BY userId,branchId').all();
    assert.equal(activeCount, 4);
    assert.deepEqual(afterRoster, beforeRoster, 'Branch status changes must preserve all staff accounts and assignments.');
    assert.deepEqual(afterAssignments, beforeAssignments, 'Branch status changes must preserve manager access assignments.');
  } finally {
    statusDb.close();
  }

  const activeBranches = await expectStatus(baseUrl, 'GET', '/public/branches', undefined, 200);
  assert.deepEqual(activeBranches.map((branch) => branch.name), activeBranchNames);
  assert.deepEqual(activeBranches.map((branch) => branch.id), activeBranchIds);

  const oldBookings = await expectStatus(baseUrl, 'GET', '/customer/bookings', customer, 200);
  for (const { branch, details, menuItem, booking, delivery, tokens } of inactiveSetups) {
    const remainingTables = details.tables.filter((table) => table.id !== booking.tableId);
    await expectStatus(baseUrl, 'GET', `/public/branches/${branch.id}`, undefined, 404);
    await expectStatus(baseUrl, 'GET', `/menu/${branch.id}`, undefined, 404);
    await expectStatus(baseUrl, 'GET', `/public/tables/${remainingTables[0].id}/availability?date=${encodeURIComponent(new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString())}`, undefined, 404);

    const rejectedBooking = await request(baseUrl, 'POST', '/customer/bookings', {
      tableId: remainingTables[0].id,
      guestCount: 2,
      date: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000 + branch.id * 60_000).toISOString(),
    }, customer);
    assert.equal(rejectedBooking.status, 400);
    assert.match(rejectedBooking.data.error, /select an active location/i);

    for (const orderType of ['COLLECTION', 'DELIVERY']) {
      const rejectedOrder = await request(baseUrl, 'POST', '/customer/orders', {
        orderType,
        branchId: branch.id,
        recipientName: 'Branch Availability Test',
        recipientPhone: '+1 (555) 010-0101',
        deliveryAddress: `${branch.address}, test delivery`,
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
      }, customer);
      assert.equal(rejectedOrder.status, 400);
      assert.match(rejectedOrder.data.error, /select an active location/i);
    }

    const rejectedDineInOrder = await request(baseUrl, 'POST', '/customer/orders', {
      orderType: 'DINE_IN',
      bookingId: booking.id,
      items: [{ menuItemId: menuItem.id, quantity: 1 }],
    }, customer);
    assert.equal(rejectedDineInOrder.status, 400);
    assert.match(rejectedDineInOrder.data.error, /select an active location/i);
    assert.ok(oldBookings.some((candidate) => candidate.id === booking.id), 'Historical reservations must remain visible.');

    const existingOrders = await expectStatus(baseUrl, 'GET', '/branch-manager/orders', tokens.manager, 200, undefined, branch.id);
    assert.ok(existingOrders.some((candidate) => candidate.id === delivery.order.id), 'Existing branch deliveries remain manageable.');
    const customerOrders = await expectStatus(baseUrl, 'GET', '/customer/orders', customer, 200);
    assert.ok(customerOrders.some((candidate) => candidate.id === delivery.order.id), 'Existing inactive-branch orders remain visible.');
    await completeDelivery(baseUrl, branch, delivery.order, { ...tokens, driver: delivery.driverToken });
  }

  for (const branch of activeBranches) {
    const tokens = staffByBranch.get(branch.id);
    const details = await expectStatus(baseUrl, 'GET', `/public/branches/${branch.id}`, undefined, 200);
    const menu = await expectStatus(baseUrl, 'GET', `/menu/${branch.id}`, undefined, 200);
    assert.ok(details.tables.length > 0);
    assert.ok(menu.length > 0);

    const booking = await expectStatus(baseUrl, 'POST', '/customer/bookings', customer, 201, {
      tableId: details.tables[0].id,
      guestCount: 2,
      date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000 + branch.id * 60_000).toISOString(),
    });
    const dineIn = await expectStatus(baseUrl, 'POST', '/customer/orders', customer, 201, {
      orderType: 'DINE_IN',
      bookingId: booking.id,
      items: [{ menuItemId: menu[0].id, quantity: 1 }],
    });
    assert.equal(dineIn.branchId, branch.id);

    const collection = await expectStatus(baseUrl, 'POST', '/customer/orders', customer, 201, {
      orderType: 'COLLECTION',
      branchId: branch.id,
      items: [{ menuItemId: menu[0].id, quantity: 1 }],
    });
    assert.equal(collection.branchId, branch.id);

    const delivery = await prepareDelivery(baseUrl, branch, tokens, menu[0], nonce);
    await completeDelivery(baseUrl, branch, delivery.order, { ...tokens, driver: delivery.driverToken });
  }

  console.log(`Branch availability E2E passed: ${activeBranchNames.length} active branches, ${inactiveSetups.length} inactive branches; reservation, ordering, delivery completion, inactive-branch rejection, and existing-delivery management verified.`);
});

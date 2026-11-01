import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { withIsolatedApi } from './e2e_test_environment.js';

const activeBranchNames = ['Steakz City Centre', 'Steakz Northside', 'Steakz Southgate', 'Steakz Uptown'];
const activeBranchIds = [1, 2, 3, 7];

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

async function expectStatus(baseUrl, method, endpoint, token, status, body, branchId) {
  const result = await request(baseUrl, method, endpoint, body, token, branchId);
  assert.equal(result.status, status, `${method} ${endpoint} response: ${JSON.stringify(result.data)}`);
  return result.data;
}

async function login(baseUrl, email, password, role) {
  const result = await expectStatus(baseUrl, 'POST', '/auth/login', undefined, 200, { email, password });
  assert.equal(result.user.role, role);
  return result.token;
}

await withIsolatedApi(async (baseUrl, databasePath) => {
  const nonce = `${Date.now()}-${process.pid}`;
  const database = new DatabaseSync(databasePath);
  let branches;
  let activeBranches;
  let managerId;
  try {
    branches = database.prepare('SELECT id,name,isActive FROM Branch ORDER BY id').all();
    activeBranches = branches.filter((branch) => branch.isActive);
    assert.deepEqual(activeBranches.map((branch) => branch.name), activeBranchNames);
    assert.deepEqual(activeBranches.map((branch) => branch.id), activeBranchIds);
    managerId = database.prepare(
      'SELECT id FROM User WHERE email=? AND role=?',
    ).get('steakz.city.centre.manager@steakz.com', 'BRANCH_MANAGER').id;
    const managerAssignments = database.prepare(
      'SELECT branchId FROM BranchManagerAssignment WHERE userId=? ORDER BY branchId',
    ).all(managerId);
    assert.deepEqual(managerAssignments.map((assignment) => assignment.branchId), activeBranches.map((branch) => branch.id));
  } finally {
    database.close();
  }

  const publicBranches = await expectStatus(baseUrl, 'GET', '/public/branches', undefined, 200);
  assert.deepEqual(publicBranches.map((branch) => branch.name), activeBranchNames);
  assert.deepEqual(publicBranches.map((branch) => branch.id), activeBranchIds);
  const managerToken = await login(baseUrl, 'steakz.city.centre.manager@steakz.com', 'password123', 'BRANCH_MANAGER');
  const customerEmail = `branch-isolation-${nonce}@test.invalid`;
  const otherCustomerEmail = `branch-isolation-other-${nonce}@test.invalid`;
  for (const [name, email] of [['Isolation Customer', customerEmail], ['Other Isolation Customer', otherCustomerEmail]]) {
    await expectStatus(baseUrl, 'POST', '/auth/register', undefined, 201, { name, email, password: 'Password123!' });
  }
  const customerToken = await login(baseUrl, customerEmail, 'Password123!', 'CUSTOMER');
  const otherCustomerToken = await login(baseUrl, otherCustomerEmail, 'Password123!', 'CUSTOMER');

  const fixtures = [];
  for (const branch of activeBranches) {
    const prefix = branch.name.toLowerCase().replace(/\s+/g, '.');
    const [chefToken, cashierToken, localManagerToken, menu, branchInfo] = await Promise.all([
      login(baseUrl, `${prefix}.chef@steakz.com`, 'password123', 'CHEF'),
      login(baseUrl, `${prefix}.cashier@steakz.com`, 'password123', 'CASHIER'),
      branch.id === branches[0].id
        ? Promise.resolve(managerToken)
        : login(baseUrl, `${prefix}.manager@steakz.com`, 'password123', 'BRANCH_MANAGER'),
      expectStatus(baseUrl, 'GET', `/menu/${branch.id}`, undefined, 200),
      expectStatus(baseUrl, 'GET', `/public/branches/${branch.id}`, undefined, 200),
    ]);
    assert.ok(menu.length > 0);
    fixtures.push({ branch, chefToken, cashierToken, localManagerToken, menuItem: menu[0], table: branchInfo.tables[0], tables: branchInfo.tables });
  }

  const collectionOrders = [];
  assert.equal(fixtures.length, 4);
  for (const fixture of fixtures) {
    const order = await expectStatus(baseUrl, 'POST', '/customer/orders', customerToken, 201, {
      orderType: 'COLLECTION',
      branchId: fixture.branch.id,
      items: [{ menuItemId: fixture.menuItem.id, quantity: 1 }],
    });
    assert.equal(order.branchId, fixture.branch.id);
    collectionOrders.push(order);
  }

  const foreignMenuOrder = await request(baseUrl, 'POST', '/customer/orders', {
    orderType: 'COLLECTION',
    branchId: fixtures[0].branch.id,
    items: [{ menuItemId: fixtures[1].menuItem.id, quantity: 1 }],
  }, customerToken);
  assert.equal(foreignMenuOrder.status, 400, 'Customer checkout cannot submit another branch menu item.');

  let crossBranchChecks = 0;
  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index];
    const otherOrders = collectionOrders.filter((_, orderIndex) => orderIndex !== index);
    const kitchen = await expectStatus(baseUrl, 'GET', '/chef/orders', fixture.chefToken, 200);
    assert.deepEqual(kitchen.map((order) => order.id), [collectionOrders[index].id]);
    const cashierOrders = await expectStatus(baseUrl, 'GET', '/cashier/orders', fixture.cashierToken, 200);
    assert.deepEqual(cashierOrders.map((order) => order.id), [collectionOrders[index].id]);
    const managerOrders = await expectStatus(baseUrl, 'GET', '/branch-manager/orders', managerToken, 200, undefined, fixture.branch.id);
    assert.deepEqual(managerOrders.map((order) => order.id), [collectionOrders[index].id]);
    assert.ok(managerOrders.every((order) => order.branch.id === fixture.branch.id && order.branch.name === fixture.branch.name));
    for (const otherOrder of otherOrders) {
      crossBranchChecks += 1;
      await expectStatus(baseUrl, 'PATCH', `/chef/orders/${otherOrder.id}/preparing`, fixture.chefToken, 403);
      await expectStatus(baseUrl, 'PATCH', `/cashier/orders/${otherOrder.id}/pay`, fixture.cashierToken, 403);
    }
  }
  assert.equal(crossBranchChecks, 12, 'All directed cross-branch pairs must be checked.');
  await expectStatus(baseUrl, 'GET', '/branch-manager/orders', managerToken, 400);
  const inactiveBranch = branches.find((branch) => !branch.isActive);
  assert.ok(inactiveBranch);
  await expectStatus(baseUrl, 'GET', '/branch-manager/orders', managerToken, 403, undefined, inactiveBranch.id);

  const bookings = [];
  for (const fixture of fixtures) {
    const booking = await expectStatus(baseUrl, 'POST', '/customer/bookings', customerToken, 201, {
      tableId: fixture.table.id,
      guestCount: 2,
      date: new Date(Date.now() + (14 + fixture.branch.id) * 24 * 60 * 60 * 1000).toISOString(),
    });
    assert.equal(booking.table.branchId, fixture.branch.id);
    bookings.push(booking);
  }
  const mismatchedDineInOrder = await request(baseUrl, 'POST', '/customer/orders', {
    orderType: 'DINE_IN',
    branchId: fixtures[0].branch.id,
    bookingId: bookings[1].id,
    items: [{ menuItemId: fixtures[1].menuItem.id, quantity: 1 }],
  }, customerToken);
  assert.equal(mismatchedDineInOrder.status, 400, 'Dine-in location must match the reservation location.');
  const dineInOrder = await expectStatus(baseUrl, 'POST', '/customer/orders', customerToken, 201, {
    orderType: 'DINE_IN',
    bookingId: bookings[1].id,
    items: [{ menuItemId: fixtures[1].menuItem.id, quantity: 1 }],
  });
  assert.equal(dineInOrder.branchId, fixtures[1].branch.id);
  await expectStatus(baseUrl, 'PATCH', `/branch-manager/bookings/${bookings[0].id}/status`, managerToken, 403, {
    status: 'CONFIRMED',
  }, fixtures[1].branch.id);
  const managerBookings = await expectStatus(baseUrl, 'GET', '/branch-manager/bookings', managerToken, 200, undefined, fixtures[1].branch.id);
  assert.ok(managerBookings.some((booking) => booking.id === bookings[1].id));
  assert.ok(managerBookings.every((booking) => booking.table.branch.id === fixtures[1].branch.id));
  await expectStatus(baseUrl, 'DELETE', `/customer/bookings/${bookings[0].id}`, otherCustomerToken, 403);
  const cancellableBooking = await expectStatus(baseUrl, 'POST', '/customer/bookings', customerToken, 201, {
    tableId: fixtures[0].tables[1].id,
    guestCount: 2,
    date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  await expectStatus(baseUrl, 'DELETE', `/customer/bookings/${cancellableBooking.id}`, customerToken, 200);

  const customerId = Number((await databaseRead(databasePath, 'SELECT id FROM User WHERE email=?', customerEmail)).id);
  const validCashierOrder = await expectStatus(baseUrl, 'POST', '/cashier/orders', fixtures[0].cashierToken, 201, {
    customerId,
    bookingId: bookings[0].id,
    items: [{ menuItemId: fixtures[0].menuItem.id, quantity: 1 }],
    branchId: fixtures[1].branch.id,
  });
  assert.equal(validCashierOrder.branchId, fixtures[0].branch.id, 'Cashier order branch comes from the authenticated cashier, not the request.');
  const wrongCashierOrder = await request(baseUrl, 'POST', '/cashier/orders', {
    customerId,
    items: [{ menuItemId: fixtures[1].menuItem.id, quantity: 1 }],
  }, fixtures[0].cashierToken);
  assert.equal(wrongCashierOrder.status, 400, 'Cashier order creation rejects another branch menu item.');
  const wrongCashierBooking = await request(baseUrl, 'POST', '/cashier/orders', {
    customerId,
    bookingId: bookings[1].id,
    items: [{ menuItemId: fixtures[0].menuItem.id, quantity: 1 }],
  }, fixtures[0].cashierToken);
  assert.equal(wrongCashierBooking.status, 400, 'Cashier order creation rejects another branch reservation.');

  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index];
    for (let orderIndex = 0; orderIndex < collectionOrders.length; orderIndex += 1) {
      await expectStatus(baseUrl, 'PATCH', `/cashier/orders/${collectionOrders[orderIndex].id}/pay`, fixture.cashierToken,
        orderIndex === index ? 200 : 403);
    }
  }
  const receipts = await expectStatus(baseUrl, 'GET', '/customer/receipts', customerToken, 200);
  assert.deepEqual(receipts.map((receipt) => receipt.branchName).sort(), activeBranchNames.slice().sort());
  await expectStatus(baseUrl, 'GET', `/customer/receipt/${collectionOrders[0].id}`, otherCustomerToken, 404);
  const ownerReceipt = await expectStatus(baseUrl, 'GET', `/customer/receipt/${collectionOrders[0].id}`, customerToken, 200);
  assert.equal(ownerReceipt.branchName, fixtures[0].branch.name);
  const ownOrders = await expectStatus(baseUrl, 'GET', '/customer/orders', customerToken, 200);
  assert.deepEqual(ownOrders.map((order) => order.id).sort((a, b) => a - b), [
    ...collectionOrders.map((order) => order.id), dineInOrder.id, validCashierOrder.id,
  ].sort((a, b) => a - b));
  assert.ok(ownOrders.every((order) => order.customerId === undefined || order.branch.name));
  assert.deepEqual(await expectStatus(baseUrl, 'GET', '/customer/orders', otherCustomerToken, 200), []);

  const menuPatch = await expectStatus(baseUrl, 'PATCH', `/branch-manager/menu/${fixtures[0].menuItem.id}`, managerToken, 200, {
    isAvailable: false,
    branchId: fixtures[1].branch.id,
  }, fixtures[0].branch.id);
  assert.equal(menuPatch.branchId, fixtures[0].branch.id, 'Menu updates cannot move items into another branch.');
  await expectStatus(baseUrl, 'PATCH', `/branch-manager/menu/${fixtures[0].menuItem.id}`, managerToken, 200, {
    isAvailable: true,
  }, fixtures[0].branch.id);
  await expectStatus(baseUrl, 'PATCH', `/branch-manager/menu/${fixtures[0].menuItem.id}`, managerToken, 403, {
    isAvailable: true,
  }, fixtures[1].branch.id);
  const genericMenuUpdate = await expectStatus(baseUrl, 'PATCH', `/menu/${fixtures[0].menuItem.id}`, managerToken, 200, {
    isAvailable: true,
    branchId: fixtures[1].branch.id,
  });
  assert.equal(genericMenuUpdate.branchId, fixtures[0].branch.id, 'Generic menu updates cannot move items into another branch.');
  await expectStatus(baseUrl, 'PATCH', `/menu/${fixtures[1].menuItem.id}`, managerToken, 403, {
    isAvailable: false,
  });

  const deliveries = [];
  for (const fixture of fixtures) {
    const driver = await expectStatus(baseUrl, 'POST', '/branch-manager/staff/drivers', managerToken, 201, {
      name: `Isolation Driver ${fixture.branch.id}`,
      email: `isolation-driver-${fixture.branch.id}-${nonce}@test.invalid`,
      password: 'Password123!',
    }, fixture.branch.id);
    assert.equal(driver.branchId, fixture.branch.id);
    const deliveryOrder = await expectStatus(baseUrl, 'POST', '/customer/orders', customerToken, 201, {
      orderType: 'DELIVERY',
      branchId: fixture.branch.id,
      recipientName: 'Branch Isolation Recipient',
      recipientPhone: '+1 (555) 010-0300',
      deliveryAddress: `${fixture.branch.name} delivery address`,
      items: [{ menuItemId: fixture.menuItem.id, quantity: 1 }],
    });
    await expectStatus(baseUrl, 'PATCH', `/delivery-management/orders/${deliveryOrder.id}/driver`, managerToken, 200, {
      driverId: driver.id,
    }, fixture.branch.id);
    deliveries.push({
      fixture,
      driver,
      driverToken: await login(baseUrl, driver.email, 'Password123!', 'DELIVERY_DRIVER'),
      order: deliveryOrder,
    });
  }

  for (let index = 0; index < deliveries.length; index += 1) {
    const delivery = deliveries[index];
    const driverOrders = await expectStatus(baseUrl, 'GET', '/driver/orders', delivery.driverToken, 200);
    assert.deepEqual(driverOrders.map((order) => order.id), [delivery.order.id]);
    for (const other of deliveries.filter((_, otherIndex) => otherIndex !== index)) {
      await expectStatus(baseUrl, 'PATCH', `/driver/orders/${other.order.id}/pickup`, delivery.driverToken, 404);
      await expectStatus(baseUrl, 'PATCH', `/delivery-management/orders/${delivery.order.id}/driver`, managerToken, 403, {
        driverId: other.driver.id,
      }, other.fixture.branch.id);
    }
    await expectStatus(baseUrl, 'PATCH', `/chef/orders/${delivery.order.id}/preparing`, delivery.fixture.chefToken, 200);
    await expectStatus(baseUrl, 'PATCH', `/chef/orders/${delivery.order.id}/done`, delivery.fixture.chefToken, 200);
    await expectStatus(baseUrl, 'PATCH', `/driver/orders/${delivery.order.id}/pickup`, delivery.driverToken, 200);
    await expectStatus(baseUrl, 'PATCH', `/driver/orders/${delivery.order.id}/delivered`, delivery.driverToken, 200);
  }

  const combined = [];
  for (const fixture of fixtures) {
    combined.push(...await expectStatus(baseUrl, 'GET', '/branch-manager/orders', managerToken, 200, undefined, fixture.branch.id));
  }
  assert.ok(combined.length >= 10);
  assert.deepEqual(
    [...new Set(combined.map((order) => order.branch.name))].sort(),
    activeBranchNames.slice().sort(),
    'The manager combined view can be composed from labelled, branch-scoped responses for all active locations.',
  );
  const hqToken = await login(baseUrl, 'hq@steakz.com', 'password123', 'HQ_MANAGER');
  const hqOrders = await expectStatus(baseUrl, 'GET', '/hq/orders', hqToken, 200);
  assert.ok(hqOrders.some((order) => order.branch.name === fixtures[0].branch.name));
  assert.ok(hqOrders.some((order) => order.branch.name === fixtures[1].branch.name));
  assert.ok(hqOrders.some((order) => order.branch.name === fixtures[2].branch.name));
  assert.ok(hqOrders.some((order) => order.branch.name === fixtures[3].branch.name));

  console.log('Strict branch isolation E2E passed for four active branches and all 12 directed cross-branch pairs.');
});

async function databaseRead(databasePath, sql, value) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare(sql).get(value);
  } finally {
    database.close();
  }
}

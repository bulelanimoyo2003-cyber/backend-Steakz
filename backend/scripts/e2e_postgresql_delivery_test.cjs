const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const jwt = require('jsonwebtoken');

const expectedBranches = [
  'Steakz City Centre',
  'Steakz Northside',
  'Steakz Southgate',
  'Steakz Uptown',
];
const databaseUrl = process.env.DATABASE_URL;
const apiUrl = new URL(process.env.API_URL || 'http://127.0.0.1:3002');
const databaseHost = databaseUrl ? new URL(databaseUrl).hostname : '';
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

if (process.env.STEAKZ_TEST_DATABASE !== 'true' || !databaseUrl || !localHosts.has(databaseHost)) {
  throw new Error('Refusing to run: set STEAKZ_TEST_DATABASE=true and use a loopback PostgreSQL DATABASE_URL.');
}
if (!localHosts.has(apiUrl.hostname)) {
  throw new Error('Refusing to run: API_URL must point to a loopback test server.');
}
if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required for the isolated API test.');
}

let database = new Client({ connectionString: databaseUrl, ssl: false });
const runId = randomUUID();
const fixtureIds = { customer: null, users: [], tables: [], menuItems: [] };
const api = async (path, { method = 'GET', token, branchId, body, key } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (branchId !== undefined) headers['X-Branch-Id'] = String(branchId);
  if (body) headers['Content-Type'] = 'application/json';
  if (key) headers['Idempotency-Key'] = key;
  const response = await fetch(new URL(`/api${path}`, apiUrl), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
};
const tokenFor = (user) => jwt.sign(
  { id: user.id, role: user.role, branchId: user.branchId },
  process.env.JWT_SECRET,
  { expiresIn: '10m' },
);
const assertStatus = (response, expected, message) => {
  assert.equal(response.status, expected, `${message}: ${JSON.stringify(response.data)}`);
};

async function createUser(name, email, role, branchId) {
  const result = await database.query(
    'INSERT INTO "User" ("name","email","password","role","branchId","updatedAt") VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING "id","role","branchId"',
    [name, email, 'unused-isolated-test-password', role, branchId],
  );
  const user = result.rows[0];
  fixtureIds.users.push(user.id);
  return user;
}

async function createStaff(branch, role, prefix) {
  return createUser(
    `Isolated ${role} ${runId}`,
    `${prefix}.${runId}@isolated.test`,
    role,
    branch.id,
  );
}

async function seedFixtures() {
  const activeResult = await database.query(
    'SELECT "id","name" FROM "Branch" WHERE "isActive" = true AND "name" = ANY($1::text[]) ORDER BY "id"',
    [expectedBranches],
  );
  const branches = activeResult.rows;
  assert.deepEqual(branches.map((branch) => branch.name).sort(), [...expectedBranches].sort());

  const selectedManagerResult = await database.query(
    'SELECT "id","email","role","branchId" FROM "User" WHERE "email"=$1 AND "role"=\'BRANCH_MANAGER\'',
    ['steakz.city.centre.manager@steakz.com'],
  );
  const manager = selectedManagerResult.rows[0];
  assert.ok(manager, 'Selected manager must exist in the test database.');
  const assignments = await database.query(
    'SELECT b."name" FROM "BranchManagerAssignment" a JOIN "Branch" b ON b."id"=a."branchId" WHERE a."userId"=$1 ORDER BY b."name"',
    [manager.id],
  );
  assert.deepEqual(
    assignments.rows.map((row) => row.name).sort(),
    [...expectedBranches].sort(),
    'Selected manager must be assigned all four branches.',
  );

  const customer = await createUser(
    `Isolated Customer ${runId}`,
    `customer.${runId}@isolated.test`,
    'CUSTOMER',
    null,
  );
  fixtureIds.customer = customer.id;
  const otherCustomer = await createUser(
    `Other Isolated Customer ${runId}`,
    `other-customer.${runId}@isolated.test`,
    'CUSTOMER',
    null,
  );
  const active = [];
  for (const branch of branches) {
    const menuResult = await database.query(
      'INSERT INTO "MenuItem" ("name","price","category","branchId","updatedAt") VALUES ($1,12.5,\'Test\',$2,NOW()) RETURNING "id"',
      [`Isolated menu ${runId}`, branch.id],
    );
    const tableResult = await database.query(
      'INSERT INTO "Table" ("tableNumber","capacity","branchId") VALUES ($1,4,$2) RETURNING "id"',
      [900000 + fixtureIds.tables.length, branch.id],
    );
    fixtureIds.menuItems.push(menuResult.rows[0].id);
    fixtureIds.tables.push(tableResult.rows[0].id);
    active.push({
      branch,
      menuItemId: menuResult.rows[0].id,
      tableId: tableResult.rows[0].id,
      chef: await createStaff(branch, 'CHEF', `chef-${branch.id}`),
      cashier: await createStaff(branch, 'CASHIER', `cashier-${branch.id}`),
      driver: await createStaff(branch, 'DELIVERY_DRIVER', `driver-${branch.id}`),
    });
  }

  const inactiveResult = await database.query(
    'SELECT "id","name" FROM "Branch" WHERE "name"=\'Steakz East Quarter\' AND "isActive"=false',
  );
  const inactiveBranch = inactiveResult.rows[0];
  assert.ok(inactiveBranch, 'East Quarter must remain inactive.');
  const inactiveManagerResult = await database.query(
    'SELECT "id","role","branchId" FROM "User" WHERE "role"=\'BRANCH_MANAGER\' AND "branchId"=$1 LIMIT 1',
    [inactiveBranch.id],
  );
  const inactiveManager = inactiveManagerResult.rows[0];
  assert.ok(inactiveManager);
  const inactiveDriver = await createStaff(inactiveBranch, 'DELIVERY_DRIVER', 'inactive-driver');
  const inactiveChef = await createStaff(inactiveBranch, 'CHEF', 'inactive-chef');
  const inactiveTableResult = await database.query(
    'INSERT INTO "Table" ("tableNumber","capacity","branchId") VALUES (900001,4,$1) RETURNING "id"',
    [inactiveBranch.id],
  );
  const inactiveMenuResult = await database.query(
    'INSERT INTO "MenuItem" ("name","price","category","branchId","updatedAt") VALUES ($1,9,\'Test\',$2,NOW()) RETURNING "id"',
    [`Inactive legacy menu ${runId}`, inactiveBranch.id],
  );
  fixtureIds.tables.push(inactiveTableResult.rows[0].id);
  fixtureIds.menuItems.push(inactiveMenuResult.rows[0].id);
  const legacyOrderResult = await database.query(
    'INSERT INTO "Order" ("customerId","branchId","orderType","total","updatedAt") VALUES ($1,$2,\'DELIVERY\',9,NOW()) RETURNING "id"',
    [customer.id, inactiveBranch.id],
  );
  const legacyOrderId = legacyOrderResult.rows[0].id;
  await database.query(
    'INSERT INTO "OrderItem" ("orderId","menuItemId","quantity","unitPrice") VALUES ($1,$2,1,9)',
    [legacyOrderId, inactiveMenuResult.rows[0].id],
  );

  return {
    branches,
    manager,
    customer,
    otherCustomer,
    active,
    inactiveBranch,
    inactiveManager,
    inactiveDriver,
    inactiveChef,
    inactiveTableId: inactiveTableResult.rows[0].id,
    legacyOrderId,
  };
}

async function runApiTests(fixture) {
  const {
    branches, manager, customer, otherCustomer, active,
    inactiveBranch, inactiveManager, inactiveDriver, inactiveChef, inactiveTableId, legacyOrderId,
  } = fixture;
  const managerToken = tokenFor(manager);
  const customerToken = tokenFor(customer);

  const visibleBranches = await api('/public/branches');
  assertStatus(visibleBranches, 200, 'Customer branch list');
  assert.deepEqual(visibleBranches.data.map((branch) => branch.name).sort(), [...expectedBranches].sort());
  const managerBranches = await api('/branch-manager/branches', { token: managerToken });
  assertStatus(managerBranches, 200, 'Manager branch selector');
  assert.deepEqual(managerBranches.data.map((branch) => branch.name).sort(), [...expectedBranches].sort());

  const activeOrders = [];
  for (const testBranch of active) {
    const { branch, menuItemId, tableId, chef, cashier, driver } = testBranch;
    const booking = await api('/customer/bookings', {
      method: 'POST',
      token: customerToken,
      body: { tableId, guestCount: 2, date: new Date(Date.now() + 86400000).toISOString() },
    });
    assertStatus(booking, 201, `${branch.name} reservation`);

    const request = {
      branchId: branch.id,
      orderType: 'DELIVERY',
      items: [{ menuItemId, quantity: 1 }],
      recipientName: 'Isolated Test Recipient',
      recipientPhone: '+15551234567',
      deliveryAddress: `${branch.name} isolated test address`,
      deliveryInstructions: 'Leave at reception',
    };
    const key = randomUUID();
    const placed = await api('/customer/orders', {
      method: 'POST', token: customerToken, body: request, key,
    });
    assertStatus(placed, 201, `${branch.name} delivery checkout`);
    const retry = await api('/customer/orders', {
      method: 'POST', token: customerToken, body: request, key,
    });
    assertStatus(retry, 200, `${branch.name} checkout retry`);
    assert.equal(retry.data.id, placed.data.id);
    assertStatus(await api('/customer/orders', {
      method: 'POST',
      token: customerToken,
      body: { ...request, deliveryInstructions: 'Different request' },
      key,
    }), 409, `${branch.name} checkout-key collision`);

    const foreignItem = active.find((entry) => entry.branch.id !== branch.id).menuItemId;
    assertStatus(await api('/customer/orders', {
      method: 'POST',
      token: customerToken,
      body: { ...request, items: [{ menuItemId: foreignItem, quantity: 1 }] },
    }), 400, `${branch.name} rejects foreign menu items`);

    const managerOrders = await api('/branch-manager/orders', { token: managerToken, branchId: branch.id });
    assertStatus(managerOrders, 200, `${branch.name} manager order list`);
    assert.ok(managerOrders.data.every((order) => order.branchId === branch.id));
    const drivers = await api('/delivery-management/drivers', { token: managerToken, branchId: branch.id });
    assertStatus(drivers, 200, `${branch.name} driver list`);
    assert.ok(drivers.data.some((entry) => entry.id === driver.id));
    assert.ok(drivers.data.every((entry) => entry.branchId === branch.id));

    assertStatus(await api(`/delivery-management/orders/${placed.data.id}/driver`, {
      method: 'PATCH',
      token: managerToken,
      branchId: branch.id,
      body: { driverId: driver.id },
    }), 200, `${branch.name} driver assignment`);
    const driverToken = tokenFor(driver);
    assertStatus(await api(`/driver/orders/${placed.data.id}/pickup`, {
      method: 'PATCH', token: driverToken,
    }), 409, `${branch.name} blocks pickup before kitchen completion`);
    const chefToken = tokenFor(chef);
    assertStatus(await api(`/chef/orders/${placed.data.id}/preparing`, {
      method: 'PATCH', token: chefToken,
    }), 200, `${branch.name} chef preparation`);
    assertStatus(await api(`/chef/orders/${placed.data.id}/done`, {
      method: 'PATCH', token: chefToken,
    }), 200, `${branch.name} kitchen-ready transition`);
    assertStatus(await api(`/driver/orders/${placed.data.id}/pickup`, {
      method: 'PATCH', token: driverToken,
    }), 200, `${branch.name} driver pickup`);
    assertStatus(await api(`/driver/orders/${placed.data.id}/delivered`, {
      method: 'PATCH', token: driverToken,
    }), 200, `${branch.name} driver completion`);
    assertStatus(await api(`/cashier/orders/${placed.data.id}/deliver`, {
      method: 'PATCH', token: tokenFor(cashier),
    }), 409, `${branch.name} prevents cashier delivery bypass`);

    const customerOrders = await api('/customer/orders', { token: customerToken });
    const customerOrder = customerOrders.data.find((order) => order.id === placed.data.id);
    assert.equal(customerOrder.branch.name, branch.name);
    assert.equal(customerOrder.deliveryStatus, 'DELIVERED');
    assert.equal(customerOrder.paymentStatus, 'UNPAID');
    const otherOrders = await api('/customer/orders', { token: tokenFor(otherCustomer) });
    assertStatus(otherOrders, 200, 'Other customer history');
    assert.equal(otherOrders.data.length, 0, 'Customers must not see another customer orders.');
    activeOrders.push({ branch, orderId: placed.data.id });
  }

  let crossBranchStaffDenials = 0;
  for (const { branch: source, chef } of active) {
    for (const { branch: target, orderId } of activeOrders) {
      if (source.id === target.id) continue;
      assertStatus(await api(`/chef/orders/${orderId}/preparing`, {
        method: 'PATCH', token: tokenFor(chef),
      }), 403, `${source.name} cannot update ${target.name} order`);
      crossBranchStaffDenials++;
    }
  }
  assert.equal(crossBranchStaffDenials, 12);

  let crossBranchDriverDenials = 0;
  for (const { branch, driver } of active) {
    const driverOrders = await api('/driver/orders', { token: tokenFor(driver) });
    assertStatus(driverOrders, 200, 'Assigned driver delivery list');
    assert.ok(driverOrders.data.every((order) => order.branch.name === branch.name
      && order.assignedDriver.id === driver.id));
    for (const { branch: target, orderId } of activeOrders) {
      if (branch.id === target.id) continue;
      assertStatus(await api(`/driver/orders/${orderId}/pickup`, {
        method: 'PATCH', token: tokenFor(driver),
      }), 404, 'Driver cannot act on another branch delivery');
      crossBranchDriverDenials++;
    }
  }
  assert.equal(crossBranchDriverDenials, 12);

  assertStatus(await api('/customer/bookings', {
    method: 'POST',
    token: customerToken,
    body: { tableId: inactiveTableId, guestCount: 2, date: new Date(Date.now() + 86400000).toISOString() },
  }), 400, 'Inactive location rejects new reservations');
  assertStatus(await api('/customer/orders', {
    method: 'POST',
    token: customerToken,
    body: {
      branchId: inactiveBranch.id,
      orderType: 'COLLECTION',
      items: [{ menuItemId: fixtureIds.menuItems[0], quantity: 1 }],
    },
  }), 400, 'Inactive location rejects new orders');
  assertStatus(await api(`/public/branches/${inactiveBranch.id}`), 404, 'Inactive location is hidden from customers');

  assertStatus(await api('/branch-manager/orders', {
    token: tokenFor(inactiveManager),
    branchId: inactiveBranch.id,
  }), 200, 'Existing inactive work remains manageable');
  assertStatus(await api(`/delivery-management/orders/${legacyOrderId}/driver`, {
    method: 'PATCH',
    token: tokenFor(inactiveManager),
    branchId: inactiveBranch.id,
    body: { driverId: inactiveDriver.id },
  }), 200, 'Inactive branch manager can assign legacy work');
  assertStatus(await api(`/chef/orders/${legacyOrderId}/preparing`, {
    method: 'PATCH', token: tokenFor(inactiveChef),
  }), 200, 'Inactive branch kitchen can finish existing work');
  assertStatus(await api(`/chef/orders/${legacyOrderId}/done`, {
    method: 'PATCH', token: tokenFor(inactiveChef),
  }), 200, 'Inactive branch kitchen can mark legacy work ready');
  assertStatus(await api(`/driver/orders/${legacyOrderId}/pickup`, {
    method: 'PATCH', token: tokenFor(inactiveDriver),
  }), 200, 'Inactive branch driver can collect existing work');
  assertStatus(await api(`/driver/orders/${legacyOrderId}/delivered`, {
    method: 'PATCH', token: tokenFor(inactiveDriver),
  }), 200, 'Inactive branch driver can complete existing work');

  return { activeOrders: activeOrders.length, crossBranchStaffDenials, crossBranchDriverDenials };
}

async function cleanupFixtures() {
  const cleanup = new Client({ connectionString: databaseUrl, ssl: false });
  await cleanup.connect();
  try {
    if (fixtureIds.customer !== null) {
      await cleanup.query('DELETE FROM "Order" WHERE "customerId"=$1', [fixtureIds.customer]);
      await cleanup.query('DELETE FROM "Booking" WHERE "customerId"=$1', [fixtureIds.customer]);
    }
    if (fixtureIds.tables.length) {
      await cleanup.query('DELETE FROM "Table" WHERE "id" = ANY($1::int[])', [fixtureIds.tables]);
    }
    if (fixtureIds.menuItems.length) {
      await cleanup.query('DELETE FROM "MenuItem" WHERE "id" = ANY($1::int[])', [fixtureIds.menuItems]);
    }
    if (fixtureIds.users.length) {
      await cleanup.query('DELETE FROM "User" WHERE "id" = ANY($1::int[])', [fixtureIds.users]);
    }
  } finally {
    await cleanup.end();
  }
}

async function main() {
  let result;
  try {
    await database.connect();
    const fixture = await seedFixtures();
    await database.end();
    database = null;
    result = await runApiTests(fixture);
  } finally {
    if (database) await database.end();
    await cleanupFixtures();
  }
  console.log(JSON.stringify({
    activeBranches: expectedBranches,
    selectedManager: 'steakz.city.centre.manager@steakz.com',
    activeDeliveryWorkflows: result.activeOrders,
    crossBranchStaffUpdateDenials: result.crossBranchStaffDenials,
    crossBranchDriverDenials: result.crossBranchDriverDenials,
    checkoutIdempotency: 'retry reused the same order; changed payload rejected',
    paymentRemainedUnpaidAfterDelivery: true,
    inactiveNewOrdersAndReservationsRejected: true,
    inactiveExistingDeliveryCompleted: true,
    fixturesCleaned: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { copyFile, mkdtemp, rm } = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const { createBackupAndClearOrders } = require('./clear_local_order_data.cjs');

const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env') });

function getLocalDatabasePath() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl?.startsWith('file:')) {
    throw new Error('This test requires the root local SQLite database.');
  }
  const databasePath = path.resolve(fileURLToPath(databaseUrl));
  const expectedPath = path.resolve(root, 'backend', 'prisma', 'dev.db');
  if (databasePath.toLowerCase() !== expectedPath.toLowerCase()) {
    throw new Error('Refusing to run the test against a database outside this checkout.');
  }
  return databasePath;
}

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startApi(databaseUrl, port, workingDirectory) {
  const child = spawn(
    process.execPath,
    [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(root, 'src', 'index.ts')],
    {
      cwd: workingDirectory,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'development',
        PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
  child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });

  const baseUrl = `http://127.0.0.1:${port}/api`;
  const readyBy = Date.now() + 30_000;
  while (Date.now() < readyBy) {
    if (child.exitCode !== null) throw new Error(`Local test API exited early: ${output}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return { child, baseUrl, output: () => output };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  throw new Error(`Local test API did not become ready: ${output}`);
}

async function stopApi(api) {
  if (api.child.exitCode !== null) return;
  const exited = new Promise((resolve) => api.child.once('exit', resolve));
  api.child.kill();
  await exited;
}

async function apiRequest(api, userId, route, options = {}, branchId) {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const response = await fetch(`${api.baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(branchId ? { 'X-Branch-Id': String(branchId) } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  assert.equal(response.ok, true, `${route} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

function getCounts(database) {
  return {
    orders: database.prepare('SELECT COUNT(*) AS count FROM "Order"').get().count,
    orderItems: database.prepare('SELECT COUNT(*) AS count FROM OrderItem').get().count,
    paymentEvents: database.prepare('SELECT COUNT(*) AS count FROM PaymentEvent').get().count,
    users: database.prepare('SELECT COUNT(*) AS count FROM User').get().count,
    branches: database.prepare('SELECT COUNT(*) AS count FROM Branch').get().count,
    managers: database.prepare('SELECT COUNT(*) AS count FROM BranchManagerAssignment').get().count,
    menuItems: database.prepare('SELECT COUNT(*) AS count FROM MenuItem').get().count,
    tables: database.prepare('SELECT COUNT(*) AS count FROM "Table"').get().count,
    bookings: database.prepare('SELECT COUNT(*) AS count FROM Booking').get().count,
  };
}

async function main() {
  if (!process.env.JWT_SECRET?.trim()) throw new Error('JWT_SECRET is required for the local API test.');

  const sourceDatabasePath = getLocalDatabasePath();
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'steakz-local-order-cleanup-'));
  const testDatabasePath = path.join(temporaryDirectory, 'dev.db');
  const backupDirectory = path.join(temporaryDirectory, 'backups');
  const source = new DatabaseSync(sourceDatabasePath, { readOnly: true });
  let seedDatabase;
  let api;

  try {
    await copyFile(sourceDatabasePath, testDatabasePath);
    seedDatabase = new DatabaseSync(testDatabasePath, { readOnly: true });
    const admin = seedDatabase.prepare(
      "SELECT id FROM User WHERE role = 'ADMIN' AND isActive = 1 ORDER BY id LIMIT 1",
    ).get();
    const hqManager = seedDatabase.prepare(
      "SELECT id FROM User WHERE role = 'HQ_MANAGER' AND isActive = 1 ORDER BY id LIMIT 1",
    ).get();
    const customer = seedDatabase.prepare(
      `SELECT customer.id, branch.id AS branchId
       FROM Branch branch
       JOIN User customer ON customer.role = 'CUSTOMER' AND customer.isActive = 1
       JOIN User chef ON chef.role = 'CHEF' AND chef.branchId = branch.id AND chef.isActive = 1
       JOIN User cashier ON cashier.role = 'CASHIER' AND cashier.branchId = branch.id AND cashier.isActive = 1
       JOIN User driver ON driver.id = branch.designatedDeliveryDriverId
         AND driver.role = 'DELIVERY_DRIVER' AND driver.branchId = branch.id AND driver.isActive = 1
       JOIN MenuItem item ON item.branchId = branch.id AND item.isAvailable = 1
       WHERE branch.isActive = 1
       ORDER BY branch.id, customer.id LIMIT 1`,
    ).get();
    const branchStaff = customer && seedDatabase.prepare(
      `SELECT
        (SELECT id FROM User WHERE role = 'CHEF' AND branchId = ? AND isActive = 1 ORDER BY id LIMIT 1) chefId,
        (SELECT id FROM User WHERE role = 'CASHIER' AND branchId = ? AND isActive = 1 ORDER BY id LIMIT 1) cashierId,
        (SELECT u.id FROM Branch b JOIN User u ON u.id = b.designatedDeliveryDriverId
          WHERE b.id = ? AND u.role = 'DELIVERY_DRIVER' AND u.branchId = ? AND u.isActive = 1) driverId`,
    ).get(customer.branchId, customer.branchId, customer.branchId, customer.branchId);
    const branchManager = customer && seedDatabase.prepare(
      `SELECT u.id FROM User u
       LEFT JOIN BranchManagerAssignment a ON a.userId = u.id AND a.branchId = ?
       WHERE u.role = 'BRANCH_MANAGER' AND u.isActive = 1
         AND (u.branchId = ? OR a.branchId = ?)
       ORDER BY u.id LIMIT 1`,
    ).get(customer.branchId, customer.branchId, customer.branchId);
    const menuItem = customer && seedDatabase.prepare(
      'SELECT id FROM MenuItem WHERE branchId = ? AND isAvailable = 1 ORDER BY id LIMIT 1',
    ).get(customer.branchId);
    assert.ok(admin && hqManager && customer && branchStaff?.chefId && branchStaff.cashierId
      && branchStaff.driverId && branchManager && menuItem,
    'The local clone needs active demo accounts and an available menu item for the complete order workflow.');

    const originalCounts = getCounts(seedDatabase);
    const originalTables = seedDatabase.prepare(
      'SELECT id, status FROM "Table" ORDER BY id',
    ).all();
    const originalTableStatuses = new Map(originalTables.map((table) => [table.id, table.status]));
    const port = await getAvailablePort();
    const databaseUrl = `file:${testDatabasePath.replace(/\\/g, '/')}`;
    seedDatabase.close();
    seedDatabase = null;
    api = await startApi(databaseUrl, port, temporaryDirectory);

    const collectionOrder = await apiRequest(api, customer.id, '/customer/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        branchId: customer.branchId,
        orderType: 'COLLECTION',
        paymentMethod: 'CASH',
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
      }),
    });
    assert.equal(collectionOrder.customerId, customer.id);
    assert.equal(collectionOrder.branchId, customer.branchId);
    assert.ok(collectionOrder.createdAt);
    assert.ok((await apiRequest(api, customer.id, '/customer/orders')).some((order) => order.id === collectionOrder.id));
    assert.ok((await apiRequest(api, branchStaff.chefId, '/chef/orders')).some((order) => order.id === collectionOrder.id));
    assert.ok((await apiRequest(api, branchStaff.cashierId, '/cashier/orders')).some((order) => order.id === collectionOrder.id));

    await apiRequest(api, branchStaff.chefId, `/chef/orders/${collectionOrder.id}/preparing`, { method: 'PATCH' });
    await apiRequest(api, branchStaff.chefId, `/chef/orders/${collectionOrder.id}/done`, { method: 'PATCH' });
    await apiRequest(api, branchStaff.cashierId, `/cashier/orders/${collectionOrder.id}/pay`, { method: 'PATCH' });
    await apiRequest(api, branchStaff.cashierId, `/cashier/orders/${collectionOrder.id}/deliver`, { method: 'PATCH' });
    assert.ok((await apiRequest(api, customer.id, '/customer/receipts'))
      .some((receipt) => receipt.orderId === collectionOrder.id));
    assert.equal((await apiRequest(api, customer.id, `/customer/receipt/${collectionOrder.id}`)).orderId,
      collectionOrder.id);

    const deliveryOrder = await apiRequest(api, customer.id, '/customer/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        branchId: customer.branchId,
        orderType: 'DELIVERY',
        paymentMethod: 'CASH',
        recipientName: 'Cleanup test recipient',
        recipientPhone: '5551234567',
        deliveryAddress: '1 Test Road',
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
      }),
    });
    assert.equal(deliveryOrder.customerId, customer.id);
    assert.equal(deliveryOrder.assignedDriverId, branchStaff.driverId);
    assert.ok((await apiRequest(api, branchStaff.driverId, '/driver/orders'))
      .some((order) => order.id === deliveryOrder.id));
    await apiRequest(api, branchStaff.chefId, `/chef/orders/${deliveryOrder.id}/preparing`, { method: 'PATCH' });
    await apiRequest(api, branchStaff.chefId, `/chef/orders/${deliveryOrder.id}/done`, { method: 'PATCH' });
    await apiRequest(api, branchStaff.cashierId, `/cashier/orders/${deliveryOrder.id}/pay`, { method: 'PATCH' });
    await apiRequest(api, branchStaff.driverId, `/driver/orders/${deliveryOrder.id}/pickup`, { method: 'PATCH' });
    await apiRequest(api, branchStaff.driverId, `/driver/orders/${deliveryOrder.id}/delivered`, { method: 'PATCH' });

    const managerOrdersBefore = await apiRequest(
      api, branchManager.id, '/branch-manager/orders', {}, customer.branchId,
    );
    assert.ok(managerOrdersBefore.some((order) => order.id === deliveryOrder.id));
    assert.ok((await apiRequest(api, hqManager.id, '/hq/orders')).some((order) => order.id === deliveryOrder.id));

    await stopApi(api);
    api = null;
    const cleanup = await createBackupAndClearOrders(testDatabasePath, backupDirectory);
    assert.equal(cleanup.after.orders, 0);
    assert.equal(cleanup.after.orderItems, 0);
    assert.equal(cleanup.after.paymentEvents, 0);
    assert.equal(cleanup.after.receipts, 0);
    assert.ok(cleanup.before.orders >= originalCounts.orders + 2);

    api = await startApi(databaseUrl, port, temporaryDirectory);
    const [customerOrders, customerReceipts, chefOrders, cashierOrders, driverOrders, managerOrders, hqOrders,
      branchOverview, branchSales, hqOverview, hqSales, adminBranches] = await Promise.all([
      apiRequest(api, customer.id, '/customer/orders'),
      apiRequest(api, customer.id, '/customer/receipts'),
      apiRequest(api, branchStaff.chefId, '/chef/orders'),
      apiRequest(api, branchStaff.cashierId, '/cashier/orders'),
      apiRequest(api, branchStaff.driverId, '/driver/orders'),
      apiRequest(api, branchManager.id, '/branch-manager/orders', {}, customer.branchId),
      apiRequest(api, hqManager.id, '/hq/orders'),
      apiRequest(api, branchManager.id, '/branch-manager/overview', {}, customer.branchId),
      apiRequest(api, branchManager.id, '/branch-manager/sales', {}, customer.branchId),
      apiRequest(api, hqManager.id, '/hq/overview'),
      apiRequest(api, hqManager.id, '/hq/sales'),
      apiRequest(api, admin.id, '/admin/branches'),
    ]);

    for (const [name, orders] of Object.entries({
      customerOrders,
      chefOrders,
      cashierOrders,
      driverOrders,
      managerOrders,
      hqOrders,
      customerReceipts,
    })) {
      assert.deepEqual(orders, [], `${name} should be empty after cleanup.`);
    }
    assert.equal(branchOverview._count.orders, 0);
    assert.equal(branchSales.orderCount, 0);
    assert.equal(branchSales.totalSales, 0);
    assert.ok(hqOverview.every((branch) => branch._count.orders === 0));
    assert.deepEqual(hqSales, []);
    assert.ok(adminBranches.length > 0);

    const verify = new DatabaseSync(testDatabasePath, { readOnly: true });
    try {
      assert.deepEqual(getCounts(verify), {
        orders: 0,
        orderItems: 0,
        paymentEvents: 0,
        users: originalCounts.users,
        branches: originalCounts.branches,
        managers: originalCounts.managers,
        menuItems: originalCounts.menuItems,
        tables: originalCounts.tables,
        bookings: originalCounts.bookings,
      });
      assert.equal(verify.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
      assert.deepEqual(verify.prepare('PRAGMA foreign_key_check').all(), []);
      const confirmedTables = verify.prepare(
        `SELECT DISTINCT t.id FROM "Table" t JOIN Booking b ON b.tableId=t.id WHERE b.status='CONFIRMED'`,
      ).all().map((table) => table.id);
      for (const tableId of confirmedTables) {
        assert.equal(verify.prepare('SELECT status FROM "Table" WHERE id = ?').get(tableId).status, 'OCCUPIED');
      }
      const activeBookingTables = verify.prepare(
        `SELECT DISTINCT tableId FROM Booking WHERE status IN ('PENDING','CONFIRMED')`,
      ).all().map((booking) => booking.tableId);
      for (const table of verify.prepare(`SELECT id,status FROM "Table"`).all()) {
        if (!activeBookingTables.includes(table.id)
          && ['OCCUPIED', 'RESERVED'].includes(originalTableStatuses.get(table.id))) {
          assert.equal(table.status, 'AVAILABLE');
        }
      }
    } finally {
      verify.close();
    }

    const backup = new DatabaseSync(cleanup.backupPath, { readOnly: true });
    try {
      const backupCounts = getCounts(backup);
      assert.equal(backupCounts.orders, cleanup.before.orders);
      assert.equal(backupCounts.orderItems, cleanup.before.orderItems);
      assert.equal(backupCounts.paymentEvents, cleanup.before.paymentEvents);
      assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    } finally {
      backup.close();
    }

    console.log(JSON.stringify({
      passed: true,
      completeCollectionAndDeliveryWorkflows: true,
      backupContainsOriginalOrders: cleanup.before.orders,
      cleanupCounts: cleanup,
      allCustomerAndStaffOrderViewsEmptyAfterRestart: true,
      receiptsEmptyAfterRestart: true,
      salesAndOrderCountsZero: true,
      accountBranchMenuTableBookingRecordsPreserved: true,
      foreignKeyAndIntegrityChecks: 'ok',
    }, null, 2));
  } finally {
    if (api) await stopApi(api);
    seedDatabase?.close();
    source.close();
    await rm(temporaryDirectory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

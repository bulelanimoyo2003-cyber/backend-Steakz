const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { copyFile, mkdtemp, rm } = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');

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
        LOCAL_DEMO_ORDER_HISTORY_ENABLED: 'true',
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

async function apiRequest(api, userId, route, options = {}) {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '5m' });
  const response = await fetch(`${api.baseUrl}${route}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json();
  assert.equal(response.ok, true, `${route} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  if (!process.env.JWT_SECRET?.trim()) throw new Error('JWT_SECRET is required for the local API test.');

  const sourceDatabasePath = getLocalDatabasePath();
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'steakz-demo-history-'));
  const testDatabasePath = path.join(temporaryDirectory, 'dev.db');
  const source = new DatabaseSync(sourceDatabasePath, { readOnly: true });
  let seedDatabase;
  let api;

  try {
    await copyFile(sourceDatabasePath, testDatabasePath);
    seedDatabase = new DatabaseSync(testDatabasePath, { readOnly: true });
    const admin = seedDatabase.prepare(
      "SELECT id FROM User WHERE role = 'ADMIN' AND isActive = 1 ORDER BY id LIMIT 1",
    ).get();
    const completedOrder = seedDatabase.prepare(
      `SELECT o.id AS orderId, o.customerId, o.branchId
       FROM "Order" o
       JOIN User u ON u.id = o.customerId
       JOIN User c ON c.branchId = o.branchId AND c.role = 'CASHIER' AND c.isActive = 1
       WHERE u.role = 'CUSTOMER' AND u.isActive = 1
         AND o.paymentStatus = 'PAID'
         AND (o.status IN ('DELIVERED', 'CANCELLED') OR o.deliveryStatus = 'DELIVERED')
       ORDER BY o.createdAt, o.id
       LIMIT 1`,
    ).get();
    const cashier = seedDatabase.prepare(
      "SELECT id FROM User WHERE role = 'CASHIER' AND branchId = ? AND isActive = 1 ORDER BY id LIMIT 1",
    );
    const chef = seedDatabase.prepare(
      "SELECT id FROM User WHERE role = 'CHEF' AND branchId = ? AND isActive = 1 ORDER BY id LIMIT 1",
    );
    const customer = completedOrder
      ? seedDatabase.prepare("SELECT id FROM User WHERE id = ? AND role = 'CUSTOMER' AND isActive = 1")
        .get(completedOrder.customerId)
      : null;
    const branchCashier = completedOrder ? cashier.get(completedOrder.branchId) : null;
    const branchChef = completedOrder ? chef.get(completedOrder.branchId) : null;
    const deliveryDriver = completedOrder
      ? seedDatabase.prepare(
        `SELECT u.id FROM Branch b
         JOIN User u ON u.id = b.designatedDeliveryDriverId
         WHERE b.id = ? AND u.role = 'DELIVERY_DRIVER' AND u.branchId = ? AND u.isActive = 1`,
      ).get(completedOrder.branchId, completedOrder.branchId)
      : null;
    const menuItem = completedOrder && branchCashier
      ? seedDatabase.prepare(
        'SELECT id FROM MenuItem WHERE branchId = ? AND isAvailable = 1 ORDER BY id LIMIT 1',
      ).get(completedOrder.branchId)
      : null;
    assert.ok(admin && customer && completedOrder && branchCashier && branchChef && deliveryDriver && menuItem,
      'The local demo needs a completed customer order and designated branch staff for each order workflow.');
    const activeOlderOrderCount = seedDatabase.prepare(
      `SELECT COUNT(*) AS count FROM "Order"
       WHERE status NOT IN ('CANCELLED', 'DELIVERED')
         AND (deliveryStatus IS NULL OR deliveryStatus <> 'DELIVERED')`,
    ).get();
    const initialOrderCount = seedDatabase.prepare('SELECT COUNT(*) AS count FROM "Order"').get().count;
    seedDatabase.close();
    seedDatabase = null;
    const port = await getAvailablePort();
    const databaseUrl = `file:${testDatabasePath.replace(/\\/g, '/')}`;
    api = await startApi(databaseUrl, port, temporaryDirectory);

    const settings = await apiRequest(api, admin.id, '/admin/local-demo-order-history', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hideOlderOrders: true }),
    });
    assert.equal(settings.enabled, true);
    assert.ok(settings.cutoffAt);
    assert.equal(settings.activeOlderOrderCount, activeOlderOrderCount.count);

    const customerOrders = await apiRequest(api, customer.id, '/customer/orders');
    const cashierOrders = await apiRequest(api, branchCashier.id, '/cashier/orders');
    const customerReceipts = await apiRequest(api, customer.id, '/customer/receipts');
    assert.equal(customerOrders.some((order) => order.id === completedOrder.orderId), false);
    assert.equal(cashierOrders.some((order) => order.id === completedOrder.orderId), false);
    assert.equal(customerReceipts.some((receipt) => receipt.orderId === completedOrder.orderId), false);
    const accessibleHistoricalReceipt = await apiRequest(
      api,
      customer.id,
      `/customer/receipt/${completedOrder.orderId}`,
    );
    assert.equal(accessibleHistoricalReceipt.orderId, completedOrder.orderId);
    assert.deepEqual(
      customerOrders.filter((order) => Date.parse(order.createdAt) < Date.parse(settings.cutoffAt))
        .map((order) => order.id).sort((a, b) => a - b),
      source.prepare(
        `SELECT id FROM "Order"
         WHERE customerId = ?
           AND status NOT IN ('CANCELLED', 'DELIVERED')
           AND (deliveryStatus IS NULL OR deliveryStatus <> 'DELIVERED')
         ORDER BY id`,
      ).all(customer.id).map((order) => order.id),
    );

    const newOrder = await apiRequest(api, customer.id, '/customer/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': require('node:crypto').randomUUID(),
      },
      body: JSON.stringify({
        branchId: completedOrder.branchId,
        orderType: 'COLLECTION',
        paymentMethod: 'CASH',
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
      }),
    });
    assert.equal(newOrder.customerId, customer.id);
    assert.equal(newOrder.branchId, completedOrder.branchId);
    assert.ok(newOrder.createdAt >= settings.cutoffAt);

    const customerOrdersWithNew = await apiRequest(api, customer.id, '/customer/orders');
    const cashierOrdersWithNew = await apiRequest(api, branchCashier.id, '/cashier/orders');
    const chefOrdersWithNew = await apiRequest(api, branchChef.id, '/chef/orders');
    assert.ok(customerOrdersWithNew.some((order) => order.id === newOrder.id));
    assert.ok(cashierOrdersWithNew.some((order) => order.id === newOrder.id));
    assert.ok(chefOrdersWithNew.some((order) => order.id === newOrder.id));

    await apiRequest(api, branchChef.id, `/chef/orders/${newOrder.id}/preparing`, { method: 'PATCH' });
    await apiRequest(api, branchChef.id, `/chef/orders/${newOrder.id}/done`, { method: 'PATCH' });
    await apiRequest(api, branchCashier.id, `/cashier/orders/${newOrder.id}/pay`, { method: 'PATCH' });
    await apiRequest(api, branchCashier.id, `/cashier/orders/${newOrder.id}/deliver`, { method: 'PATCH' });
    const customerReceiptsWithNew = await apiRequest(api, customer.id, '/customer/receipts');
    const receipt = await apiRequest(api, customer.id, `/customer/receipt/${newOrder.id}`);
    assert.ok(customerReceiptsWithNew.some((item) => item.orderId === newOrder.id));
    assert.equal(receipt.orderId, newOrder.id);

    const deliveryOrder = await apiRequest(api, customer.id, '/customer/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': require('node:crypto').randomUUID(),
      },
      body: JSON.stringify({
        branchId: completedOrder.branchId,
        orderType: 'DELIVERY',
        paymentMethod: 'CASH',
        recipientName: 'Demo Test Recipient',
        recipientPhone: '5551234567',
        deliveryAddress: '1 Test Road',
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
      }),
    });
    assert.equal(deliveryOrder.customerId, customer.id);
    assert.equal(deliveryOrder.branchId, completedOrder.branchId);
    assert.equal(deliveryOrder.assignedDriverId, deliveryDriver.id);
    const assignedDeliveries = await apiRequest(api, deliveryDriver.id, '/driver/orders');
    assert.ok(assignedDeliveries.some((order) => order.id === deliveryOrder.id));

    await apiRequest(api, branchChef.id, `/chef/orders/${deliveryOrder.id}/preparing`, { method: 'PATCH' });
    await apiRequest(api, branchChef.id, `/chef/orders/${deliveryOrder.id}/done`, { method: 'PATCH' });
    await apiRequest(api, branchCashier.id, `/cashier/orders/${deliveryOrder.id}/pay`, { method: 'PATCH' });
    await apiRequest(api, deliveryDriver.id, `/driver/orders/${deliveryOrder.id}/pickup`, { method: 'PATCH' });
    await apiRequest(api, deliveryDriver.id, `/driver/orders/${deliveryOrder.id}/delivered`, { method: 'PATCH' });

    await stopApi(api);
    api = await startApi(databaseUrl, port, temporaryDirectory);
    const persistedSettings = await apiRequest(api, admin.id, '/admin/local-demo-order-history');
    assert.equal(persistedSettings.cutoffAt, settings.cutoffAt);
    const ordersAfterRestart = await apiRequest(api, customer.id, '/customer/orders');
    assert.equal(ordersAfterRestart.some((order) => order.id === completedOrder.orderId), false);
    assert.ok(ordersAfterRestart.some((order) => order.id === newOrder.id));
    assert.ok(ordersAfterRestart.some((order) => order.id === deliveryOrder.id));

    const restored = await apiRequest(api, admin.id, '/admin/local-demo-order-history', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hideOlderOrders: false }),
    });
    assert.equal(restored.cutoffAt, null);
    const visibleAfterRestore = await apiRequest(api, customer.id, '/customer/orders');
    const receiptsAfterRestore = await apiRequest(api, customer.id, '/customer/receipts');
    assert.ok(visibleAfterRestore.some((order) => order.id === completedOrder.orderId));
    assert.ok(receiptsAfterRestore.some((receipt) => receipt.orderId === completedOrder.orderId));

    assert.equal(source.prepare('SELECT COUNT(*) AS count FROM "Order"').get().count, initialOrderCount);
    console.log(JSON.stringify({
      passed: true,
      oldCompletedOrderHidden: completedOrder.orderId,
      olderActiveOrdersPreserved: settings.activeOlderOrderCount,
      newOrderId: newOrder.id,
      newOrderCustomerId: newOrder.customerId,
      newOrderBranchId: newOrder.branchId,
      newOrderVisibleTo: ['customer', 'branch chef', 'branch cashier', 'customer receipts'],
      newOrderCompletedThrough: ['chef preparation', 'cashier payment', 'cashier delivery', 'receipt'],
      deliveryOrderId: deliveryOrder.id,
      deliveryCompletedThrough: ['automatic assignment', 'chef preparation', 'cashier payment', 'driver pickup', 'driver delivery'],
      cutoffPersistedAcrossApiRestart: true,
      restoreRevealsOldHistory: true,
      originalDatabaseOrderCountUnchanged: initialOrderCount,
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

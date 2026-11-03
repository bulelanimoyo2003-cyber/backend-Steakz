const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const expectedBranches = [
  'Steakz City Centre',
  'Steakz Northside',
  'Steakz Southgate',
  'Steakz Uptown',
];
const testDirectory = path.join(os.tmpdir(), 'steakz-root-delivery-e2e');
const databasePath = path.join(testDirectory, 'delivery-workflow-test.db');
const databaseUrl = `file:${databasePath.replace(/\\/g, '/')}`;
const jwtSecret = crypto.randomBytes(32).toString('hex');
const rootDirectory = path.resolve(__dirname, '..');
const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

if (process.env.STEAKZ_TEST_DATABASE !== 'true') {
  throw new Error('Refusing to run: set STEAKZ_TEST_DATABASE=true to use the isolated SQLite E2E database.');
}

function runPrismaMigrations() {
  const prismaCli = path.join(rootDirectory, 'node_modules', 'prisma', 'build', 'index.js');
  const result = spawnSync(process.execPath, [
    prismaCli,
    'migrate',
    'deploy',
    '--schema',
    path.join(rootDirectory, 'prisma', 'schema.prisma'),
  ], {
    cwd: rootDirectory,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (result.status !== 0) {
    throw new Error(`Isolated SQLite migrations failed:\n${result.stdout}\n${result.stderr}`);
  }
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function seedTestFixtures(prisma, bcrypt) {
  const branches = [];
  for (const [index, name] of expectedBranches.entries()) {
    branches.push(await prisma.branch.create({
      data: { name, address: `${index + 1} Isolated Test Street`, isActive: true },
    }));
  }

  const password = await bcrypt.hash('Isolated-Test-1234!', 10);
  const manager = await prisma.user.create({
    data: {
      name: 'Isolated Test Manager',
      email: 'manager@isolated.test',
      password,
      role: 'BRANCH_MANAGER',
      branchId: branches[0].id,
    },
  });
  const [admin, hqManager] = await Promise.all([
    prisma.user.create({
      data: {
        name: 'Isolated Test Admin',
        email: 'admin@isolated.test',
        password,
        role: 'ADMIN',
      },
    }),
    prisma.user.create({
      data: {
        name: 'Isolated Test HQ Manager',
        email: 'hq-manager@isolated.test',
        password,
        role: 'HQ_MANAGER',
      },
    }),
  ]);
  await prisma.branchManagerAssignment.createMany({
    data: branches.map((branch) => ({ userId: manager.id, branchId: branch.id })),
  });
  const restrictedManager = await prisma.user.create({
    data: {
      name: 'Isolated Single Branch Manager',
      email: 'single-manager@isolated.test',
      password,
      role: 'BRANCH_MANAGER',
      branchId: branches[0].id,
    },
  });
  await prisma.branchManagerAssignment.create({
    data: { userId: restrictedManager.id, branchId: branches[0].id },
  });
  const customer = await prisma.user.create({
    data: {
      name: 'Isolated Test Customer',
      email: 'customer@isolated.test',
      password,
      role: 'CUSTOMER',
    },
  });
  const otherCustomer = await prisma.user.create({
    data: {
      name: 'Other Isolated Customer',
      email: 'other-customer@isolated.test',
      password,
      role: 'CUSTOMER',
    },
  });
  const otherDriver = await prisma.user.create({
    data: {
      name: 'Unassigned Same Branch Driver',
      email: 'other-driver@isolated.test',
      password,
      role: 'DELIVERY_DRIVER',
      branchId: branches[0].id,
    },
  });

  const branchFixtures = [];
  for (const branch of branches) {
    const [chef, cashier, driver, menuItem] = await Promise.all([
      prisma.user.create({
        data: {
          name: `${branch.name} Chef`,
          email: `chef-${branch.id}@isolated.test`,
          password,
          role: 'CHEF',
          branchId: branch.id,
        },
      }),
      prisma.user.create({
        data: {
          name: `${branch.name} Cashier`,
          email: `cashier-${branch.id}@isolated.test`,
          password,
          role: 'CASHIER',
          branchId: branch.id,
        },
      }),
      prisma.user.create({
        data: {
          name: `${branch.name} Driver`,
          email: `driver-${branch.id}@isolated.test`,
          password,
          role: 'DELIVERY_DRIVER',
          branchId: branch.id,
        },
      }),
      prisma.menuItem.create({
        data: {
          name: `Isolated menu ${branch.id}`,
          price: 12.5,
          category: 'Test',
          branchId: branch.id,
        },
      }),
    ]);
    branchFixtures.push({ branch, chef, cashier, driver, menuItem });
  }
  await Promise.all(branchFixtures.map(({ branch, driver }) => prisma.branch.update({
    where: { id: branch.id },
    data: { designatedDeliveryDriverId: driver.id },
  })));
  return {
    prisma, branches, admin, hqManager, manager, restrictedManager,
    customer, otherCustomer, otherDriver, branchFixtures,
  };
}

function tokenFor(user) {
  return jwt.sign(
    { id: user.id, role: user.role, branchId: user.branchId },
    jwtSecret,
    { expiresIn: '10m' },
  );
}

function createApi(baseUrl) {
  return async (route, { method = 'GET', token, branchId, body, idempotencyKey } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (branchId !== undefined) headers['X-Branch-Id'] = String(branchId);
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (body) headers['Content-Type'] = 'application/json';
    const response = await fetch(new URL(`/api${route}`, baseUrl), {
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
    return { status: response.status, data, cacheControl: response.headers.get('cache-control') };
  };
}

async function waitForServer(baseUrl, child, logs) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Isolated API exited during startup:\n${logs.slice(-60).join('')}`);
    }
    try {
      const response = await fetch(new URL('/api/health', baseUrl));
      if (response.ok) return;
    } catch {
      // The local test API is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out starting isolated API:\n${logs.slice(-60).join('')}`);
}

async function runWorkflow(initialApi, fixtures, restartApi) {
  let api = initialApi;
  const managerToken = tokenFor(fixtures.manager);
  const restrictedManagerToken = tokenFor(fixtures.restrictedManager);
  const customerToken = tokenFor(fixtures.customer);
  const otherCustomerToken = tokenFor(fixtures.otherCustomer);
  const visibleBranches = await api('/public/branches');
  assert.equal(visibleBranches.status, 200);
  assert.deepEqual(visibleBranches.data.map((branch) => branch.name).sort(), [...expectedBranches].sort());
  assert.ok(visibleBranches.data.every((branch) => branch.deliveryAvailable));

  const managerBranches = await api('/branch-manager/branches', { token: managerToken });
  assert.equal(managerBranches.status, 200);
  assert.deepEqual(managerBranches.data.map((branch) => branch.name).sort(), [...expectedBranches].sort());

  const restrictedAccess = await api('/branch-manager/orders', {
    token: restrictedManagerToken,
    branchId: fixtures.branches[1].id,
  });
  assert.equal(restrictedAccess.status, 403, 'branch staff cannot access an unassigned branch');

  const firstFixture = fixtures.branchFixtures[0];
  const beforeUnavailableCheckout = await fixtures.prisma.order.count();
  await fixtures.prisma.branch.update({
    where: { id: firstFixture.branch.id },
    data: { designatedDeliveryDriverId: null },
  });
  const unavailable = await api('/customer/orders', {
    method: 'POST',
    token: customerToken,
    body: {
      branchId: firstFixture.branch.id,
      orderType: 'DELIVERY',
      items: [{ menuItemId: firstFixture.menuItem.id, quantity: 1 }],
      recipientName: 'Isolated Recipient',
      recipientPhone: '+15551234567',
      deliveryAddress: `${firstFixture.branch.name} delivery test address`,
    },
  });
  assert.equal(unavailable.status, 409);
  assert.match(unavailable.data.error, /Delivery is unavailable/);
  assert.equal(await fixtures.prisma.order.count(), beforeUnavailableCheckout);
  await fixtures.prisma.branch.update({
    where: { id: firstFixture.branch.id },
    data: { designatedDeliveryDriverId: firstFixture.driver.id },
  });

  const orders = [];
  for (const { branch, chef, cashier, driver, menuItem } of fixtures.branchFixtures) {
    const checkoutKey = crypto.randomUUID();
    const body = {
      branchId: branch.id,
      orderType: 'DELIVERY',
      items: [{ menuItemId: menuItem.id, quantity: 1 }],
      recipientName: 'Isolated Recipient',
      recipientPhone: '+15551234567',
      deliveryAddress: `${branch.name} delivery test address`,
      deliveryInstructions: 'Test only',
    };
    const placed = await api('/customer/orders', {
      method: 'POST',
      token: customerToken,
      body,
      idempotencyKey: checkoutKey,
    });
    assert.equal(placed.status, 201, `${branch.name} checkout: ${JSON.stringify(placed.data)}`);
    assert.equal(placed.data.assignedDriverId, driver.id, `${branch.name} was automatically assigned its designated driver`);
    assert.equal(placed.data.deliveryStatus, 'ASSIGNED');
    assert.ok(placed.data.assignedAt);
    assert.equal(placed.data.assignedDriver.id, driver.id);
    const retry = await api('/customer/orders', {
      method: 'POST',
      token: customerToken,
      body,
      idempotencyKey: checkoutKey,
    });
    assert.equal(retry.status, 200, 'same checkout request is idempotent');
    assert.equal(retry.data.id, placed.data.id);
    orders.push({ branch, chef, cashier, driver, orderId: placed.data.id });
  }
  assert.equal(await fixtures.prisma.order.count(), beforeUnavailableCheckout + 4);

  api = await restartApi();
  const customerOrdersAfterRestart = await api('/customer/orders', { token: customerToken });
  assert.equal(customerOrdersAfterRestart.status, 200);
  assert.equal(customerOrdersAfterRestart.data.length, 4);
  assert.ok(customerOrdersAfterRestart.data.every((order) => order.deliveryStatus === 'ASSIGNED'));

  let crossBranchDriverDenials = 0;
  let assignedBeforeKitchenReady = 0;
  const pickupGateCombinations = [];
  for (const [index, { branch, chef, cashier, driver, orderId }] of orders.entries()) {
    const login = await api('/auth/login', {
      method: 'POST',
      body: { email: driver.email, password: 'Isolated-Test-1234!' },
    });
    assert.equal(login.status, 200, `${branch.name} driver login`);
    assert.equal(login.data.user.role, 'DELIVERY_DRIVER');
    assert.equal(login.data.user.branchId, branch.id);
    const driverToken = login.data.token;
    const profile = await api('/driver/profile', { token: driverToken });
    assert.equal(profile.status, 200);
    assert.equal(profile.data.branch.name, branch.name);

    const ownOrders = await api('/driver/orders', { token: driverToken });
    assert.equal(ownOrders.status, 200);
    assert.equal(ownOrders.cacheControl, 'no-store');
    assert.deepEqual(ownOrders.data.map((order) => order.id), [orderId]);
    assert.equal(ownOrders.data[0].deliveryStatus, 'ASSIGNED');
    assert.equal(ownOrders.data[0].status, 'PENDING');
    assert.equal(ownOrders.data[0].paymentStatus, 'UNPAID');
    assignedBeforeKitchenReady += 1;

    const kitchenPrepared = index === 1 || index === 3;
    const paymentConfirmed = index === 2 || index === 3;
    pickupGateCombinations.push(`${kitchenPrepared ? 'prepared' : 'unprepared'}+${paymentConfirmed ? 'paid' : 'unpaid'}`);
    if (kitchenPrepared) {
      assert.equal((await api(`/chef/orders/${orderId}/preparing`, {
        method: 'PATCH', token: tokenFor(chef),
      })).status, 200);
      assert.equal((await api(`/chef/orders/${orderId}/done`, {
        method: 'PATCH', token: tokenFor(chef),
      })).status, 200);
    }
    if (paymentConfirmed) {
      const paid = await api(`/cashier/orders/${orderId}/pay`, {
        method: 'PATCH', token: tokenFor(cashier),
      });
      assert.equal(paid.status, 200, `${branch.name} cashier payment confirmation`);
      assert.equal(paid.data.paymentStatus, 'PAID');
    }

    if (index === 3) {
      api = await restartApi();
      const afterRestart = await api('/driver/orders', { token: driverToken });
      assert.equal(afterRestart.status, 200);
      const persistedOrder = afterRestart.data.find((order) => order.id === orderId);
      assert.equal(persistedOrder.status, 'DONE');
      assert.equal(persistedOrder.paymentStatus, 'PAID');
      assert.equal(persistedOrder.deliveryStatus, 'ASSIGNED');
    }

    const pickupAttempt = await api(`/driver/orders/${orderId}/pickup`, {
      method: 'PATCH', token: driverToken,
    });
    if (kitchenPrepared && paymentConfirmed) {
      assert.equal(pickupAttempt.status, 200, 'prepared and paid delivery can be collected');
      assert.equal(pickupAttempt.data.deliveryStatus, 'OUT_FOR_DELIVERY');
    } else {
      assert.equal(pickupAttempt.status, 409, 'pickup is blocked unless both kitchen and payment are complete');
      assert.match(pickupAttempt.data.error, kitchenPrepared
        ? /cashier confirms payment/
        : paymentConfirmed
          ? /kitchen finishes preparing/
          : /kitchen finishes preparing.*cashier confirms payment/);
      const unchangedOrder = await api('/driver/orders', { token: driverToken });
      const unchanged = unchangedOrder.data.find((order) => order.id === orderId);
      assert.equal(unchanged.status, kitchenPrepared ? 'DONE' : 'PENDING');
      assert.equal(unchanged.paymentStatus, paymentConfirmed ? 'PAID' : 'UNPAID');
    }
    const refreshedDriverOrders = await api('/driver/orders', { token: driverToken });
    const refreshedOrder = refreshedDriverOrders.data.find((order) => order.id === orderId);
    assert.equal(refreshedOrder.status, kitchenPrepared ? 'DONE' : 'PENDING');
    assert.equal(refreshedOrder.paymentStatus, paymentConfirmed ? 'PAID' : 'UNPAID');
    assert.equal(refreshedOrder.deliveryStatus, pickupAttempt.status === 200
      ? 'OUT_FOR_DELIVERY'
      : 'ASSIGNED');

    const otherOrder = orders.find((target) => target.branch.id !== branch.id);
    const crossBranchRead = await api('/driver/orders', { token: driverToken });
    assert.ok(crossBranchRead.data.every((order) => order.branch.name === branch.name));
    const crossBranchMutation = await api(`/driver/orders/${otherOrder.orderId}/pickup`, {
      method: 'PATCH',
      token: driverToken,
    });
    assert.equal(crossBranchMutation.status, 404);
    crossBranchDriverDenials += 1;
    if (index === 0) {
      const otherDriverOrders = await api('/driver/orders', {
        token: tokenFor(fixtures.otherDriver),
      });
      assert.equal(otherDriverOrders.status, 200);
      assert.equal(otherDriverOrders.data.length, 0, 'same-branch non-assigned drivers cannot see the order');
      const otherDriverMutation = await api(`/driver/orders/${orderId}/pickup`, {
        method: 'PATCH',
        token: tokenFor(fixtures.otherDriver),
      });
      assert.equal(otherDriverMutation.status, 404, 'same-branch non-assigned drivers cannot collect the order');
    }

    const managerOrdersBeforeReady = await api('/branch-manager/orders', {
      token: managerToken,
      branchId: branch.id,
    });
    assert.ok(managerOrdersBeforeReady.data.some((order) => order.id === orderId
      && order.deliveryStatus === (pickupAttempt.status === 200 ? 'OUT_FOR_DELIVERY' : 'ASSIGNED')
      && order.assignedDriverId === driver.id));
    const managerCrossBranchRequest = await api('/branch-manager/orders', {
      token: restrictedManagerToken,
      branchId: branch.id,
    });
    if (branch.id !== fixtures.branches[0].id) assert.equal(managerCrossBranchRequest.status, 403);

    const chefToken = tokenFor(chef);
    if (!kitchenPrepared) {
      assert.equal((await api(`/chef/orders/${orderId}/preparing`, {
        method: 'PATCH', token: chefToken,
      })).status, 200);
      assert.equal((await api(`/chef/orders/${orderId}/done`, {
        method: 'PATCH', token: chefToken,
      })).status, 200);
    }
    if (!paymentConfirmed) {
      const paid = await api(`/cashier/orders/${orderId}/pay`, {
        method: 'PATCH', token: tokenFor(cashier),
      });
      assert.equal(paid.status, 200);
      assert.equal(paid.data.paymentStatus, 'PAID');
    }

    const customerAssignedOrders = await api('/customer/orders', { token: customerToken });
    const customerAssignedOrder = customerAssignedOrders.data.find((order) => order.id === orderId);
    assert.equal(customerAssignedOrder.status, 'DONE');
    assert.equal(customerAssignedOrder.deliveryStatus, pickupAttempt.status === 200 ? 'OUT_FOR_DELIVERY' : 'ASSIGNED');
    assert.equal(customerAssignedOrder.assignedDriver.id, driver.id);

    const pickedUp = pickupAttempt.status === 200
      ? pickupAttempt
      : await api(`/driver/orders/${orderId}/pickup`, { method: 'PATCH', token: driverToken });
    assert.equal(pickedUp.status, 200);
    assert.ok(pickedUp.data.pickedUpAt);
    assert.equal(pickedUp.data.paymentStatus, 'PAID');
    const managerOutForDelivery = await api('/branch-manager/orders', {
      token: managerToken,
      branchId: branch.id,
    });
    assert.equal(managerOutForDelivery.data.find((order) => order.id === orderId).deliveryStatus, 'OUT_FOR_DELIVERY');
    const customerOutForDelivery = await api('/customer/orders', { token: customerToken });
    assert.equal(customerOutForDelivery.data.find((order) => order.id === orderId).deliveryStatus, 'OUT_FOR_DELIVERY');
    assert.equal((await api(`/driver/orders/${orderId}/pickup`, {
      method: 'PATCH', token: driverToken,
    })).status, 200, 'pickup retry is idempotent');

    const delivered = await api(`/driver/orders/${orderId}/delivered`, {
      method: 'PATCH',
      token: driverToken,
    });
    assert.equal(delivered.status, 200);
    assert.equal(delivered.data.status, 'DONE', 'delivery completion does not change the kitchen status');
    assert.ok(delivered.data.deliveredAt);
    const managerDeliveredOrders = await api('/branch-manager/orders', {
      token: managerToken,
      branchId: branch.id,
    });
    assert.equal(managerDeliveredOrders.data.find((order) => order.id === orderId).deliveryStatus, 'DELIVERED');
    const customerDeliveredOrders = await api('/customer/orders', { token: customerToken });
    const customerDelivered = customerDeliveredOrders.data.find((order) => order.id === orderId);
    assert.equal(customerDelivered.deliveryStatus, 'DELIVERED');
    assert.equal(customerDelivered.status, 'DONE');
    assert.equal(customerDelivered.paymentStatus, 'PAID', 'delivery actions preserve the cashier-confirmed payment state');
    assert.equal((await api(`/driver/orders/${orderId}/delivered`, {
      method: 'PATCH', token: driverToken,
    })).status, 200, 'delivery retry is idempotent');
    const freshLogin = await api('/auth/login', {
      method: 'POST',
      body: { email: driver.email, password: 'Isolated-Test-1234!' },
    });
    const historyAfterLogin = await api('/driver/orders', { token: freshLogin.data.token });
    assert.equal(historyAfterLogin.data.find((order) => order.id === orderId).deliveryStatus, 'DELIVERED');
  }

  assert.equal(crossBranchDriverDenials, 4);
  assert.equal(assignedBeforeKitchenReady, 4);
  assert.deepEqual(pickupGateCombinations, [
    'unprepared+unpaid',
    'prepared+unpaid',
    'unprepared+paid',
    'prepared+paid',
  ]);
  const otherCustomerOrders = await api('/customer/orders', { token: otherCustomerToken });
  assert.equal(otherCustomerOrders.data.length, 0);
  assert.equal((await api(`/customer/receipt/${orders[0].orderId}`, {
    token: otherCustomerToken,
  })).status, 404, 'customers cannot read another customer receipt');

  const receipt = await api(`/customer/receipt/${orders[0].orderId}`, { token: customerToken });
  assert.equal(receipt.status, 200);
  assert.equal(receipt.data.deliveryStatus, 'DELIVERED');
  assert.equal(receipt.data.assignedDriverName, orders[0].driver.name);
  assert.ok(receipt.data.deliveredAt);

  const hqOrders = await api('/hq/orders', { token: tokenFor(fixtures.hqManager) });
  assert.equal(hqOrders.status, 200);
  assert.ok(orders.every(({ orderId }) => hqOrders.data.some((order) => order.id === orderId)));
  const customerOrders = await api('/customer/orders', { token: customerToken });
  for (const order of customerOrders.data) {
    assert.equal(order.status, 'DONE');
    assert.equal(order.deliveryStatus, 'DELIVERED');
    assert.ok(order.pickedUpAt);
    assert.ok(order.deliveredAt);
  }
  assert.ok(customerOrders.data.every((order) => order.paymentStatus === 'PAID'));
  return {
    activeBranches: expectedBranches,
    automaticAssignments: orders.length,
    completedWorkflows: orders.length,
    restartPersistence: true,
    idempotentCheckoutRetries: orders.length,
    unavailableBranchRejected: true,
    assignedBeforeKitchenReady,
    pickupGateCombinations,
    crossBranchDriverDenials,
    crossBranchStaffDenial: true,
    customerIsolation: true,
    paymentRemainsSeparateFromDelivery: true,
    receiptShowsDeliveryCompletion: true,
  };
}

async function main() {
  if (fs.existsSync(testDirectory) && fs.readdirSync(testDirectory).length > 0) {
    throw new Error(`Refusing to use a non-empty isolated test directory: ${testDirectory}`);
  }
  fs.mkdirSync(testDirectory, { recursive: true });
  let apiProcess;
  let prisma;
  const logs = [];
  try {
    process.env.DATABASE_URL = databaseUrl;
    runPrismaMigrations();
    const { PrismaClient } = require('@prisma/client');
    const bcrypt = require('bcryptjs');
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const fixtures = await seedTestFixtures(prisma, bcrypt);

    const port = await unusedPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const startApi = async () => {
      apiProcess = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
        cwd: rootDirectory,
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          FRONTEND_URL: 'http://127.0.0.1:5173',
          JWT_SECRET: jwtSecret,
          NODE_ENV: 'production',
          PORT: String(port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      apiProcess.stdout.on('data', (chunk) => logs.push(chunk.toString()));
      apiProcess.stderr.on('data', (chunk) => logs.push(chunk.toString()));
      await waitForServer(baseUrl, apiProcess, logs);
      return createApi(baseUrl);
    };
    const restartApi = async () => {
      const previousProcess = apiProcess;
      if (previousProcess && previousProcess.exitCode === null) {
        previousProcess.kill();
        await new Promise((resolve) => previousProcess.once('exit', resolve));
      }
      return startApi();
    };
    const result = await runWorkflow(await startApi(), fixtures, restartApi);
    console.log(JSON.stringify({ ...result, isolatedDatabaseCleaned: true }, null, 2));
  } finally {
    if (apiProcess && apiProcess.exitCode === null) {
      apiProcess.kill();
      await new Promise((resolve) => apiProcess.once('exit', resolve));
    }
    if (prisma) await prisma.$disconnect();
    for (const filename of ['delivery-workflow-test.db', 'delivery-workflow-test.db-journal', 'delivery-workflow-test.db-wal', 'delivery-workflow-test.db-shm']) {
      const filePath = path.join(testDirectory, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    if (fs.existsSync(testDirectory) && fs.readdirSync(testDirectory).length === 0) {
      fs.rmdirSync(testDirectory);
    }
    if (logs.length && process.exitCode) console.error(logs.slice(-60).join(''));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

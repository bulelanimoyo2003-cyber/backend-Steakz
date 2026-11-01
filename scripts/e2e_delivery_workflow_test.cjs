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
  const customer = await prisma.user.create({
    data: {
      name: 'Isolated Test Customer',
      email: 'customer@isolated.test',
      password,
      role: 'CUSTOMER',
    },
  });

  const branchFixtures = [];
  for (const branch of branches) {
    const [chef, driver, menuItem] = await Promise.all([
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
    branchFixtures.push({ branch, chef, driver, menuItem });
  }
  return { branches, admin, hqManager, manager, customer, branchFixtures };
}

function tokenFor(user) {
  return jwt.sign(
    { id: user.id, role: user.role, branchId: user.branchId },
    jwtSecret,
    { expiresIn: '10m' },
  );
}

function createApi(baseUrl) {
  return async (route, { method = 'GET', token, branchId, body } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (branchId !== undefined) headers['X-Branch-Id'] = String(branchId);
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
    return { status: response.status, data };
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

async function runWorkflow(api, fixtures) {
  const adminToken = tokenFor(fixtures.admin);
  const hqManagerToken = tokenFor(fixtures.hqManager);
  const managerToken = tokenFor(fixtures.manager);
  const customerToken = tokenFor(fixtures.customer);
  const visibleBranches = await api('/public/branches');
  assert.equal(visibleBranches.status, 200);
  assert.deepEqual(visibleBranches.data.map((branch) => branch.name).sort(), [...expectedBranches].sort());

  const managerBranches = await api('/branch-manager/branches', { token: managerToken });
  assert.equal(managerBranches.status, 200);
  assert.deepEqual(managerBranches.data.map((branch) => branch.name).sort(), [...expectedBranches].sort());

  const orders = [];
  let privilegedAssignmentChecks = 0;
  let crossBranchManagerDenials = 0;
  let readyOrderAssignments = 0;
  for (const { branch, chef, driver, menuItem } of fixtures.branchFixtures) {
    const placed = await api('/customer/orders', {
      method: 'POST',
      token: customerToken,
      body: {
        branchId: branch.id,
        orderType: 'DELIVERY',
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
        recipientName: 'Isolated Recipient',
        recipientPhone: '+15551234567',
        deliveryAddress: `${branch.name} delivery test address`,
        deliveryInstructions: 'Test only',
      },
    });
    assert.equal(placed.status, 201, `${branch.name} checkout: ${JSON.stringify(placed.data)}`);
    orders.push({ branch, chef, driver, orderId: placed.data.id });
  }

  for (const { branch, chef, driver, orderId } of orders) {
    const branchOrders = await api('/branch-manager/orders', {
      token: managerToken,
      branchId: branch.id,
    });
    assert.equal(branchOrders.status, 200);
    assert.ok(branchOrders.data.every((order) => order.branchId === branch.id));
    assert.ok(branchOrders.data.some((order) => order.id === orderId));

    const wrongBranchView = await api('/branch-manager/orders', {
      token: managerToken,
      branchId: orders.find((entry) => entry.branch.id !== branch.id).branch.id,
    });
    assert.equal(wrongBranchView.status, 200);
    assert.ok(wrongBranchView.data.every((order) => order.branchId !== branch.id));

    const wrongDriverAssignment = await api(`/delivery-management/orders/${orderId}/driver`, {
      method: 'PATCH',
      token: managerToken,
      branchId: branch.id,
      body: { driverId: orders.find((entry) => entry.branch.id !== branch.id).driver.id },
    });
    assert.equal(wrongDriverAssignment.status, 400);

    const wrongBranchSelection = await api(`/delivery-management/orders/${orderId}/driver`, {
      method: 'PATCH',
      token: managerToken,
      branchId: orders.find((entry) => entry.branch.id !== branch.id).branch.id,
      body: { driverId: driver.id },
    });
    assert.equal(wrongBranchSelection.status, 403);
    crossBranchManagerDenials += 1;

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

    const chefToken = tokenFor(chef);
    assert.equal((await api(`/chef/orders/${orderId}/preparing`, {
      method: 'PATCH', token: chefToken,
    })).status, 200);
    assert.equal((await api(`/chef/orders/${orderId}/done`, {
      method: 'PATCH', token: chefToken,
    })).status, 200);

    const assigned = await api(`/delivery-management/orders/${orderId}/driver`, {
      method: 'PATCH',
      token: managerToken,
      branchId: branch.id,
      body: { driverId: driver.id },
    });
    assert.equal(assigned.status, 200, `${branch.name} DONE order driver assignment`);
    assert.equal(assigned.data.status, 'DONE');
    assert.equal(assigned.data.deliveryStatus, 'ASSIGNED');
    assert.equal(assigned.data.assignedDriverId, driver.id);
    readyOrderAssignments += 1;

    if (branch.name === expectedBranches[0]) {
      for (const token of [adminToken, hqManagerToken]) {
        const privilegedAssignment = await api(`/delivery-management/orders/${orderId}/driver`, {
          method: 'PATCH',
          token,
          body: { driverId: driver.id },
        });
        assert.equal(privilegedAssignment.status, 200);
        assert.equal(privilegedAssignment.data.branchId, branch.id);
        privilegedAssignmentChecks += 1;
      }
    }

    const managerAssignedOrders = await api('/branch-manager/orders', {
      token: managerToken,
      branchId: branch.id,
    });
    const managerAssignedOrder = managerAssignedOrders.data.find((order) => order.id === orderId);
    assert.equal(managerAssignedOrder.deliveryStatus, 'ASSIGNED');
    assert.equal(managerAssignedOrder.assignedDriverId, driver.id);

    const customerAssignedOrders = await api('/customer/orders', { token: customerToken });
    const customerAssignedOrder = customerAssignedOrders.data.find((order) => order.id === orderId);
    assert.equal(customerAssignedOrder.status, 'DONE');
    assert.equal(customerAssignedOrder.deliveryStatus, 'ASSIGNED');
    assert.equal(customerAssignedOrder.assignedDriver.id, driver.id);

    const ownOrders = await api('/driver/orders', { token: driverToken });
    assert.equal(ownOrders.status, 200);
    assert.deepEqual(ownOrders.data.map((order) => order.id), [orderId]);
    assert.equal(ownOrders.data[0].status, 'DONE');
    assert.equal(ownOrders.data[0].deliveryStatus, 'ASSIGNED');

    const pickedUp = await api(`/driver/orders/${orderId}/pickup`, {
      method: 'PATCH',
      token: driverToken,
    });
    assert.equal(pickedUp.status, 200);
    assert.ok(pickedUp.data.pickedUpAt);
    const managerOutForDelivery = await api('/branch-manager/orders', {
      token: managerToken,
      branchId: branch.id,
    });
    assert.equal(
      managerOutForDelivery.data.find((order) => order.id === orderId).deliveryStatus,
      'OUT_FOR_DELIVERY',
    );
    const customerOutForDelivery = await api('/customer/orders', { token: customerToken });
    assert.equal(
      customerOutForDelivery.data.find((order) => order.id === orderId).deliveryStatus,
      'OUT_FOR_DELIVERY',
    );
    assert.equal((await api(`/driver/orders/${orderId}/pickup`, {
      method: 'PATCH',
      token: driverToken,
    })).status, 200, 'pickup retry is idempotent');

    const delivered = await api(`/driver/orders/${orderId}/delivered`, {
      method: 'PATCH',
      token: driverToken,
    });
    assert.equal(delivered.status, 200);
    assert.ok(delivered.data.deliveredAt);
    const managerDeliveredOrders = await api('/branch-manager/orders', {
      token: managerToken,
      branchId: branch.id,
    });
    assert.equal(
      managerDeliveredOrders.data.find((order) => order.id === orderId).deliveryStatus,
      'DELIVERED',
    );
    const customerDeliveredOrders = await api('/customer/orders', { token: customerToken });
    assert.equal(
      customerDeliveredOrders.data.find((order) => order.id === orderId).deliveryStatus,
      'DELIVERED',
    );
    const driverHistory = await api('/driver/orders', { token: driverToken });
    assert.equal(driverHistory.data.find((order) => order.id === orderId).deliveryStatus, 'DELIVERED');
    assert.equal((await api(`/driver/orders/${orderId}/delivered`, {
      method: 'PATCH',
      token: driverToken,
    })).status, 200, 'delivery retry is idempotent');
  }

  let crossBranchDenials = 0;
  for (const { branch, driver } of fixtures.branchFixtures) {
    const ordersForDriver = await api('/driver/orders', { token: tokenFor(driver) });
    assert.equal(ordersForDriver.status, 200);
    assert.ok(ordersForDriver.data.every((order) => order.branch.name === branch.name));
    for (const target of orders) {
      if (target.branch.id === branch.id) continue;
      const denied = await api(`/driver/orders/${target.orderId}/pickup`, {
        method: 'PATCH',
        token: tokenFor(driver),
      });
      assert.equal(denied.status, 404);
      crossBranchDenials += 1;
    }
  }
  assert.equal(crossBranchDenials, 12);
  assert.equal(crossBranchManagerDenials, 4);
  assert.equal(privilegedAssignmentChecks, 2);

  const customerOrders = await api('/customer/orders', { token: customerToken });
  assert.equal(customerOrders.status, 200);
  assert.equal(customerOrders.data.length, 4);
  for (const order of customerOrders.data) {
    assert.equal(order.status, 'DELIVERED');
    assert.equal(order.deliveryStatus, 'DELIVERED');
    assert.equal(order.paymentStatus, 'UNPAID');
    assert.ok(order.pickedUpAt);
    assert.ok(order.deliveredAt);
  }
  return {
    activeBranches: expectedBranches,
    workflows: orders.length,
    readyOrderAssignments,
    crossBranchDriverDenials: crossBranchDenials,
    crossBranchManagerDenials,
    privilegedAssignmentChecks,
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
    const result = await runWorkflow(createApi(baseUrl), fixtures);
    console.log(JSON.stringify({ ...result, checkoutPaymentRemainedUnpaid: true, isolatedDatabaseCleaned: true }, null, 2));
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

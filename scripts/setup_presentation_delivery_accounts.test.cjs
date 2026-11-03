const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  EXPECTED_BRANCHES,
  ensurePresentationDeliveryAccounts,
  getPresentationDatabasePath,
} = require('./setup_presentation_delivery_accounts.cjs');

function createMockPrisma(existingUsers = new Map(), pendingOrders = []) {
  const users = new Map(existingUsers);
  const branches = EXPECTED_BRANCHES.map((branch, index) => ({
    id: index + 1,
    name: branch.name,
  }));
  const calls = { creates: 0, updates: 0, branchUpdates: 0, orderUpdates: 0 };
  const userModel = {
    async findUnique({ where }) {
      if (where.email === 'admin@steakz.com') return { id: 1, role: 'ADMIN', isActive: true };
      if (where.email === 'steakz.city.centre.manager@steakz.com') {
        return {
          id: 2,
          role: 'BRANCH_MANAGER',
          managedBranches: branches.map((branch) => ({ branch: { name: branch.name } })),
        };
      }
      return users.get(where.email) ?? null;
    },
  };
  const tx = {
    user: {
      async create({ data }) {
        calls.creates += 1;
        const user = { id: users.size + 10, ...data };
        users.set(data.email, user);
        return user;
      },
      async update({ where, data }) {
        calls.updates += 1;
        const existing = [...users.values()].find((user) => user.id === where.id);
        const user = { ...existing, ...data };
        users.set(user.email, user);
        return user;
      },
    },
    branch: {
      async update({ where, data }) {
        calls.branchUpdates += 1;
        const branch = branches.find((candidate) => candidate.id === where.id);
        Object.assign(branch, data);
        return branch;
      },
    },
    order: {
      async findMany() { return pendingOrders; },
      async updateMany({ where, data }) {
        calls.orderUpdates += 1;
        const order = pendingOrders.find((candidate) => candidate.id === where.id
          && candidate.branchId === where.branchId
          && candidate.assignedDriverId === null
          && candidate.deliveryStatus === null);
        if (!order) return { count: 0 };
        Object.assign(order, data);
        return { count: 1 };
      },
    },
  };
  return {
    users,
    calls,
    async $transaction(callback) { return callback(tx); },
    branches,
    pendingOrders,
    branch: { async findMany() { return branches; } },
    user: userModel,
  };
}

test('creates four branch-scoped presentation drivers with hashed demo passwords', async () => {
  const prisma = createMockPrisma();
  const result = await ensurePresentationDeliveryAccounts(
    prisma,
    async (password, rounds) => `hashed:${password}:${rounds}`,
  );
  assert.equal(result.accounts.length, 4);
  assert.equal(prisma.calls.creates, 4);
  assert.deepEqual(result.accounts.map(({ email, branch }) => ({ email, branch })), EXPECTED_BRANCHES.map(
    ({ email, name }) => ({ email, branch: name }),
  ));
  for (const account of prisma.users.values()) {
    assert.equal(account.password, 'hashed:1234:10');
    assert.equal(account.role, 'DELIVERY_DRIVER');
    assert.equal(account.isActive, true);
  }
  assert.equal(prisma.calls.branchUpdates, 4);
  for (const branch of prisma.branches) {
    assert.ok(branch.designatedDeliveryDriverId);
  }
});

test('reruns update only the matching driver accounts without creating duplicates', async () => {
  const existing = new Map(EXPECTED_BRANCHES.map((branch, index) => [branch.email, {
    id: index + 10,
    name: `Existing ${branch.driverName}`,
    email: branch.email,
    role: 'DELIVERY_DRIVER',
    branchId: index + 1,
    password: 'old-hash',
    isActive: false,
    salary: 1200,
  }]));
  const prisma = createMockPrisma(existing);
  await ensurePresentationDeliveryAccounts(prisma, async () => 'new-hash');
  assert.equal(prisma.calls.creates, 0);
  assert.equal(prisma.calls.updates, 4);
  for (const account of prisma.users.values()) {
    assert.equal(account.password, 'new-hash');
    assert.equal(account.isActive, true);
    assert.match(account.name, /^Existing /);
    assert.equal(account.role, 'DELIVERY_DRIVER');
    assert.equal(account.branchId, Number(account.email.includes('city.centre') ? 1
      : account.email.includes('northside') ? 2
        : account.email.includes('southgate') ? 3 : 4));
    assert.equal(account.salary, 1200);
  }
});

test('repairs only unassigned active delivery orders and records a real assignment timestamp', async () => {
  const order = { id: 33, branchId: 1, assignedDriverId: null, deliveryStatus: null };
  const prisma = createMockPrisma(new Map(), [order]);
  const before = Date.now();
  const result = await ensurePresentationDeliveryAccounts(prisma, async () => 'hash');
  const after = Date.now();
  assert.deepEqual(result.repairedOrderIds, [33]);
  assert.equal(order.deliveryStatus, 'ASSIGNED');
  assert.ok(order.assignedDriverId);
  assert.ok(order.assignedAt instanceof Date);
  assert.ok(order.assignedAt.getTime() >= before && order.assignedAt.getTime() <= after);
});

test('refuses to take over an email assigned to another role or branch', async () => {
  const existing = new Map([[EXPECTED_BRANCHES[0].email, {
    id: 10,
    email: EXPECTED_BRANCHES[0].email,
    role: 'CASHIER',
    branchId: 1,
  }]]);
  const prisma = createMockPrisma(existing);
  await assert.rejects(
    ensurePresentationDeliveryAccounts(prisma, async () => 'hash'),
    /different role or branch; no driver accounts were changed/,
  );
  assert.equal(prisma.calls.creates, 0);
  assert.equal(prisma.calls.updates, 0);
});

test('refuses to make accounts when any configured active branch is missing', async () => {
  const prisma = createMockPrisma();
  prisma.branch.findMany = async () => [];
  await assert.rejects(
    ensurePresentationDeliveryAccounts(prisma, async () => 'hash'),
    /four configured active branches/,
  );
});

test('refuses to modify SQLite files outside the project presentation database', () => {
  const otherDatabase = pathToFileURL(path.join(os.tmpdir(), 'steakz-other-database.db')).href;
  assert.throws(
    () => getPresentationDatabasePath(otherDatabase),
    /Refusing to modify any database other than the configured project presentation database/,
  );
});

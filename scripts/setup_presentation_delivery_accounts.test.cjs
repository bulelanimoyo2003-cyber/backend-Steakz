const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED_BRANCHES,
  ensurePresentationDeliveryAccounts,
} = require('./setup_presentation_delivery_accounts.cjs');

function createMockPrisma(existingUsers = new Map()) {
  const users = new Map(existingUsers);
  const branches = EXPECTED_BRANCHES.map((branch, index) => ({
    id: index + 1,
    name: branch.name,
  }));
  const calls = { creates: 0, updates: 0 };
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
  };
  return {
    users,
    calls,
    async $transaction(callback) { return callback(tx); },
    branch: { async findMany() { return branches; } },
    user: userModel,
  };
}

test('creates four branch-scoped presentation drivers with hashed demo passwords', async () => {
  const prisma = createMockPrisma();
  const accounts = await ensurePresentationDeliveryAccounts(
    prisma,
    async (password, rounds) => `hashed:${password}:${rounds}`,
  );
  assert.equal(accounts.length, 4);
  assert.equal(prisma.calls.creates, 4);
  assert.deepEqual(accounts.map(({ email, branch }) => ({ email, branch })), EXPECTED_BRANCHES.map(
    ({ email, name }) => ({ email, branch: name }),
  ));
  for (const account of prisma.users.values()) {
    assert.equal(account.password, 'hashed:1234:10');
    assert.equal(account.role, 'DELIVERY_DRIVER');
    assert.equal(account.isActive, true);
  }
});

test('reruns update only the matching driver accounts without creating duplicates', async () => {
  const existing = new Map(EXPECTED_BRANCHES.map((branch, index) => [branch.email, {
    id: index + 10,
    email: branch.email,
    role: 'DELIVERY_DRIVER',
    branchId: index + 1,
    password: 'old-hash',
    isActive: false,
  }]));
  const prisma = createMockPrisma(existing);
  await ensurePresentationDeliveryAccounts(prisma, async () => 'new-hash');
  assert.equal(prisma.calls.creates, 0);
  assert.equal(prisma.calls.updates, 4);
  for (const account of prisma.users.values()) {
    assert.equal(account.password, 'new-hash');
    assert.equal(account.isActive, true);
  }
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

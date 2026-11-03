const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED_BRANCHES,
} = require('./setup_presentation_delivery_accounts.cjs');
const {
  REQUIRED_ROLES,
  assertPresentationAccounts,
  setPresentationPasswords,
} = require('./set_presentation_passwords.cjs');

function fixtures() {
  const branches = EXPECTED_BRANCHES.map((branch, index) => ({
    id: index + 1,
    name: branch.name,
  }));
  const users = REQUIRED_ROLES.map((role, index) => ({
    id: index + 1,
    name: `${role} user`,
    email: `${role.toLowerCase()}@presentation.test`,
    role,
    isActive: true,
    branch: null,
  }));
  users.push({
    id: users.length + 1,
    name: 'Additional Customer',
    email: 'friend@steakz.com',
    role: 'CUSTOMER',
    isActive: true,
    branch: null,
  });
  for (const [index, branch] of EXPECTED_BRANCHES.entries()) {
    users.push({
      id: users.length + 1,
      name: branch.driverName,
      email: branch.email,
      role: 'DELIVERY_DRIVER',
      isActive: true,
      branch: { name: branch.name },
    });
  }
  return { branches, users };
}

test('updates every retained role and customer password without changing account data', async () => {
  const { branches, users } = fixtures();
  const calls = [];
  const transaction = {
    branch: { async findMany() { return branches; } },
    user: {
      async findMany() { return users; },
      async updateMany(args) {
        calls.push(args);
        return { count: users.length };
      },
    },
  };
  const accounts = await setPresentationPasswords(
    { async $transaction(callback) { return callback(transaction); } },
    async (password, rounds) => {
      assert.equal(password, '1234');
      assert.equal(rounds, 10);
      return 'bcrypt-hash';
    },
  );

  assert.equal(accounts.length, users.length);
  assert.deepEqual(accounts.map(({ id }) => id), users.map(({ id }) => id));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].data, { password: 'bcrypt-hash' });
  assert.deepEqual(calls[0].where.id.in, users.map(({ id }) => id));
  assert.ok(accounts.every((account) => !Object.hasOwn(account, 'password')));
});

test('refuses to proceed when a required presentation role is missing', () => {
  const { branches, users } = fixtures();
  assert.throws(
    () => assertPresentationAccounts(users.filter((user) => user.role !== 'CASHIER'), branches),
    /required presentation roles are missing: CASHIER/,
  );
});

test('refuses to proceed when an expected designated driver is missing, inactive, or misassigned', () => {
  const { branches, users } = fixtures();
  const driver = users.find((user) => user.email === EXPECTED_BRANCHES[0].email);
  driver.isActive = false;
  assert.throws(
    () => assertPresentationAccounts(users, branches),
    /expected an active delivery account .* for Steakz City Centre/,
  );
  driver.isActive = true;
  driver.branch.name = 'Steakz Northside';
  assert.throws(
    () => assertPresentationAccounts(users, branches),
    /expected an active delivery account .* for Steakz City Centre/,
  );
});

test('refuses to proceed when active branches do not match presentation locations', () => {
  const { branches, users } = fixtures();
  assert.throws(
    () => assertPresentationAccounts(users, branches.slice(1)),
    /expected exactly the four active presentation branches/,
  );
});

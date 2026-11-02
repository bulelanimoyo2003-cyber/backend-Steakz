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
    branch: null,
  }));
  for (const [index, branch] of EXPECTED_BRANCHES.entries()) {
    users.push({
      id: users.length + 1,
      name: branch.driverName,
      email: branch.email,
      role: 'DELIVERY_DRIVER',
      branch: { name: branch.name },
    });
  }
  return { branches, users };
}

test('updates only the password of every existing account', async () => {
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
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].data, { password: 'bcrypt-hash' });
  assert.equal(calls[0].where.id.in.length, users.length);
  assert.ok(accounts.every((account) => !Object.hasOwn(account, 'password')));
});

test('refuses to proceed when one of the required roles is missing', () => {
  const { branches, users } = fixtures();
  assert.throws(
    () => assertPresentationAccounts(users.filter((user) => user.role !== 'CASHIER'), branches),
    /required presentation roles are missing/,
  );
});

test('refuses to proceed when active branches do not match presentation locations', () => {
  const { branches, users } = fixtures();
  assert.throws(
    () => assertPresentationAccounts(users, branches.slice(1)),
    /expected exactly the four active presentation branches/,
  );
});

test('refuses to proceed when a delivery account has the wrong branch', () => {
  const { branches, users } = fixtures();
  users.find((user) => user.email === EXPECTED_BRANCHES[0].email).branch.name = 'Steakz Northside';
  assert.throws(
    () => assertPresentationAccounts(users, branches),
    /expected delivery account .* for Steakz City Centre/,
  );
});

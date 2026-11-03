const test = require('node:test');
const assert = require('node:assert/strict');
const {
  EXPECTED_BRANCHES,
} = require('./setup_presentation_delivery_accounts.cjs');
const {
  assertPresentationAccounts,
  setPresentationPasswords,
} = require('./set_presentation_passwords.cjs');

function fixtures() {
  const branches = EXPECTED_BRANCHES.map((branch, index) => ({
    id: index + 1,
    name: branch.name,
  }));
  const users = [{
    id: 1,
    name: 'Sample Customer',
    email: 'customer@steakz.com',
    role: 'CUSTOMER',
    isActive: true,
    branch: null,
  }, {
    id: 2,
    name: 'Unrelated Account',
    email: 'friend@steakz.com',
    role: 'CUSTOMER',
    isActive: true,
    branch: null,
  }];
  for (const [index, branch] of EXPECTED_BRANCHES.entries()) {
    users.push({
      id: index + 3,
      name: branch.driverName,
      email: branch.email,
      role: 'DELIVERY_DRIVER',
      isActive: true,
      branch: { name: branch.name },
    });
  }
  return { branches, users };
}

test('updates only the customer and four presentation driver passwords', async () => {
  const { branches, users } = fixtures();
  const calls = [];
  const transaction = {
    branch: { async findMany() { return branches; } },
    user: {
      async findMany() { return users; },
      async updateMany(args) {
        calls.push(args);
        return { count: 5 };
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

  assert.equal(accounts.length, 5);
  assert.deepEqual(accounts.map(({ id }) => id), [1, 3, 4, 5, 6]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].data, { password: 'bcrypt-hash' });
  assert.deepEqual(calls[0].where.id.in, [1, 3, 4, 5, 6]);
  assert.ok(accounts.every((account) => !Object.hasOwn(account, 'password')));
});

test('refuses to proceed when a required presentation account is missing or inactive', () => {
  const { branches, users } = fixtures();
  assert.throws(
    () => assertPresentationAccounts(users.filter((user) => user.email !== 'customer@steakz.com'), branches),
    /expected an active CUSTOMER account customer@steakz.com/,
  );
  users[0].isActive = false;
  assert.throws(
    () => assertPresentationAccounts(users, branches),
    /expected an active CUSTOMER account customer@steakz.com/,
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
    /expected an active DELIVERY_DRIVER account .* for Steakz City Centre/,
  );
});

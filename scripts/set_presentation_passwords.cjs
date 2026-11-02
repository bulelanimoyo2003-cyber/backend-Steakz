const { fileURLToPath } = require('node:url');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const {
  EXPECTED_BRANCHES,
  getPresentationDatabasePath,
} = require('./setup_presentation_delivery_accounts.cjs');

const PASSWORD = '1234';
const REQUIRED_ROLES = [
  'ADMIN',
  'HQ_MANAGER',
  'BRANCH_MANAGER',
  'CHEF',
  'CASHIER',
  'CUSTOMER',
  'DELIVERY_DRIVER',
];

function assertPresentationAccounts(users, branches) {
  const expectedBranchNames = EXPECTED_BRANCHES.map(({ name }) => name).sort();
  const actualBranchNames = branches.map(({ name }) => name).sort();
  if (actualBranchNames.length !== expectedBranchNames.length
    || actualBranchNames.some((name, index) => name !== expectedBranchNames[index])) {
    throw new Error('Refusing to update passwords: expected exactly the four active presentation branches.');
  }

  const roles = new Set(users.map(({ role }) => role));
  if (REQUIRED_ROLES.some((role) => !roles.has(role))) {
    throw new Error('Refusing to update passwords: one or more required presentation roles are missing.');
  }

  const usersByEmail = new Map(users.map((user) => [user.email, user]));
  for (const expected of EXPECTED_BRANCHES) {
    const user = usersByEmail.get(expected.email);
    if (!user || user.role !== 'DELIVERY_DRIVER' || user.branch?.name !== expected.name) {
      throw new Error(`Refusing to update passwords: expected delivery account ${expected.email} for ${expected.name}.`);
    }
  }
}

async function setPresentationPasswords(prisma, hashPassword) {
  const passwordHash = await hashPassword(PASSWORD, 10);
  return prisma.$transaction(async (transaction) => {
    const [branches, users] = await Promise.all([
      transaction.branch.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
      }),
      transaction.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          branch: { select: { name: true } },
        },
        orderBy: { id: 'asc' },
      }),
    ]);

    assertPresentationAccounts(users, branches);
    const result = await transaction.user.updateMany({
      where: { id: { in: users.map(({ id }) => id) } },
      data: { password: passwordHash },
    });
    if (result.count !== users.length) {
      throw new Error(`Password update count mismatch: expected ${users.length}, updated ${result.count}.`);
    }
    return users.map(({ name, email, role, branch }) => ({
      name,
      email,
      role,
      branch: branch?.name ?? null,
    }));
  });
}

async function main() {
  if (process.env.STEAKZ_PRESENTATION_PASSWORD_UPDATE !== 'true'
    || process.env.NODE_ENV === 'production') {
    throw new Error(
      'Set STEAKZ_PRESENTATION_PASSWORD_UPDATE=true in a non-production environment to run this one-time update.',
    );
  }
  if (!process.env.DATABASE_URL?.startsWith('file:')) {
    throw new Error('DATABASE_URL must point to the local SQLite presentation database.');
  }

  const databasePath = getPresentationDatabasePath(process.env.DATABASE_URL);
  const databaseUrl = `file:${fileURLToPath(process.env.DATABASE_URL).replace(/\\/g, '/')}`;
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const accounts = await setPresentationPasswords(
      prisma,
      (password, rounds) => bcrypt.hash(password, rounds),
    );
    console.log(JSON.stringify({
      database: databasePath,
      updatedAccountCount: accounts.length,
      accounts,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  REQUIRED_ROLES,
  assertPresentationAccounts,
  setPresentationPasswords,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

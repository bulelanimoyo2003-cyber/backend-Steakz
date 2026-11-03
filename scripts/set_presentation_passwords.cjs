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
  const missingRoles = REQUIRED_ROLES.filter((role) => !roles.has(role));
  if (missingRoles.length) {
    throw new Error(`Refusing to update passwords: required presentation roles are missing: ${missingRoles.join(', ')}.`);
  }

  const usersByEmail = new Map(users.map((user) => [user.email, user]));
  for (const expected of EXPECTED_BRANCHES) {
    const user = usersByEmail.get(expected.email);
    if (!user || !user.isActive || user.role !== 'DELIVERY_DRIVER'
      || user.branch?.name !== expected.name) {
      throw new Error(`Refusing to update passwords: expected an active delivery account ${expected.email} for ${expected.name}.`);
    }
  }
  return users;
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
          isActive: true,
          branch: { select: { name: true } },
        },
        orderBy: { id: 'asc' },
      }),
    ]);

    const accounts = assertPresentationAccounts(users, branches);
    const result = await transaction.user.updateMany({
      where: { id: { in: accounts.map(({ id }) => id) } },
      data: { password: passwordHash },
    });
    if (result.count !== accounts.length) {
      throw new Error(`Password update count mismatch: expected ${accounts.length}, updated ${result.count}.`);
    }
    return accounts.map(({ id, name, email, role, branch }) => ({
      id,
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

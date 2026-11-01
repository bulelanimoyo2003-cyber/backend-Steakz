const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const PASSWORD = '1234';
const EXPECTED_BRANCHES = [
  { name: 'Steakz City Centre', driverName: 'Steakz City Centre Delivery', email: 'steakz.city.centre.delivery@steakz.com' },
  { name: 'Steakz Northside', driverName: 'Steakz Northside Delivery', email: 'steakz.northside.delivery@steakz.com' },
  { name: 'Steakz Southgate', driverName: 'Steakz Southgate Delivery', email: 'steakz.southgate.delivery@steakz.com' },
  { name: 'Steakz Uptown', driverName: 'Steakz Uptown Delivery', email: 'steakz.uptown.delivery@steakz.com' },
];

function getPresentationDatabasePath(databaseUrl) {
  if (!databaseUrl?.startsWith('file:')) {
    throw new Error('DATABASE_URL must point to a local SQLite presentation database.');
  }
  const databasePath = path.resolve(fileURLToPath(databaseUrl));
  const presentationDirectory = path.resolve(
    os.homedir(),
    'AppData',
    'Local',
    'Steakz',
    'delivery-preview',
  );
  const relativePath = path.relative(presentationDirectory, databasePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)
    || !/^steakz-preview-\d{8}-\d{6}\.db$/i.test(path.basename(databasePath))) {
    throw new Error('Refusing to modify a database outside the local Steakz delivery-preview presentation directory.');
  }
  if (!fs.existsSync(databasePath)) {
    throw new Error('The configured presentation database file does not exist.');
  }
  return databasePath;
}

async function ensurePresentationDeliveryAccounts(prisma, hashPassword) {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  const branchesByName = new Map(branches.map((branch) => [branch.name, branch]));
  if (branches.length !== EXPECTED_BRANCHES.length
    || EXPECTED_BRANCHES.some((branch) => !branchesByName.has(branch.name))) {
    throw new Error('Expected exactly the four configured active branches before creating presentation drivers.');
  }

  const admin = await prisma.user.findUnique({
    where: { email: 'admin@steakz.com' },
    select: { id: true, role: true, isActive: true },
  });
  if (!admin || admin.role !== 'ADMIN' || !admin.isActive) {
    throw new Error('The active presentation admin account was not found; no driver accounts were changed.');
  }

  const manager = await prisma.user.findUnique({
    where: { email: 'steakz.city.centre.manager@steakz.com' },
    select: {
      id: true,
      role: true,
      managedBranches: { select: { branch: { select: { name: true } } } },
    },
  });
  const managerBranches = new Set(manager?.managedBranches.map(({ branch }) => branch.name));
  if (!manager || manager.role !== 'BRANCH_MANAGER'
    || EXPECTED_BRANCHES.some((branch) => !managerBranches.has(branch.name))) {
    throw new Error('The selected branch manager is not assigned to all four branches; no driver accounts were changed.');
  }

  const accounts = await Promise.all(EXPECTED_BRANCHES.map(async (expected) => {
    const branch = branchesByName.get(expected.name);
    const existing = await prisma.user.findUnique({
      where: { email: expected.email },
      select: { id: true, role: true, branchId: true },
    });
    if (existing && (existing.role !== 'DELIVERY_DRIVER' || existing.branchId !== branch.id)) {
      throw new Error(`Account ${expected.email} already exists with a different role or branch; no driver accounts were changed.`);
    }
    return {
      ...expected,
      branchId: branch.id,
      existingId: existing?.id,
      passwordHash: await hashPassword(PASSWORD, 10),
    };
  }));

  return prisma.$transaction(async (transaction) => {
    const result = [];
    for (const account of accounts) {
      const data = {
        name: account.driverName,
        email: account.email,
        password: account.passwordHash,
        role: 'DELIVERY_DRIVER',
        branchId: account.branchId,
        isActive: true,
      };
      const user = account.existingId
        ? await transaction.user.update({ where: { id: account.existingId }, data })
        : await transaction.user.create({ data });
      result.push({ name: user.name, email: user.email, branch: account.name, role: user.role });
    }
    return result;
  });
}

async function main() {
  if (process.env.STEAKZ_PRESENTATION_SETUP !== 'true' || process.env.NODE_ENV === 'production') {
    throw new Error('Set STEAKZ_PRESENTATION_SETUP=true in a non-production environment to run this one-time setup.');
  }
  const databasePath = getPresentationDatabasePath(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${databasePath.replace(/\\/g, '/')}` } } });
  try {
    const accounts = await ensurePresentationDeliveryAccounts(prisma, (password, rounds) => bcrypt.hash(password, rounds));
    console.log(JSON.stringify({ database: 'local presentation SQLite', accounts }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = { EXPECTED_BRANCHES, ensurePresentationDeliveryAccounts, getPresentationDatabasePath };

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

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
  const projectDatabasePath = path.resolve(__dirname, '..', 'backend', 'prisma', 'dev.db');
  if (path.relative(projectDatabasePath, databasePath) !== '') {
    throw new Error('Refusing to modify any database other than the configured project presentation database.');
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
    const branchDrivers = new Map();
    for (const account of accounts) {
      const data = account.existingId
        ? { password: account.passwordHash, isActive: true }
        : {
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
      await transaction.branch.update({
        where: { id: account.branchId },
        data: { designatedDeliveryDriverId: user.id },
      });
      branchDrivers.set(account.branchId, user.id);
      result.push({ name: user.name, email: user.email, branch: account.name, role: user.role });
    }

    const pendingOrders = await transaction.order.findMany({
      where: {
        orderType: 'DELIVERY',
        status: { notIn: ['CANCELLED', 'DELIVERED'] },
        OR: [
          { deliveryStatus: null },
          { assignedDriverId: null },
        ],
      },
      select: { id: true, branchId: true, assignedDriverId: true, deliveryStatus: true },
      orderBy: { id: 'asc' },
    });
    const repairedOrderIds = [];
    const unmatchedOrders = [];
    for (const order of pendingOrders) {
      const driverId = branchDrivers.get(order.branchId);
      if (!driverId || order.assignedDriverId !== null || order.deliveryStatus !== null) {
        unmatchedOrders.push({
          id: order.id,
          branchId: order.branchId,
          reason: !driverId ? 'No designated driver is configured for this branch.' : 'The existing assignment state is inconsistent.',
        });
        continue;
      }
      const updated = await transaction.order.updateMany({
        where: {
          id: order.id,
          branchId: order.branchId,
          orderType: 'DELIVERY',
          status: { notIn: ['CANCELLED', 'DELIVERED'] },
          deliveryStatus: null,
          assignedDriverId: null,
        },
        data: {
          assignedDriverId: driverId,
          deliveryStatus: 'ASSIGNED',
          assignedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new Error(`Order ${order.id} changed during the presentation delivery repair.`);
      }
      repairedOrderIds.push(order.id);
    }

    return {
      accounts: result,
      repairedOrderIds,
      unmatchedOrders,
    };
  });
}

async function main() {
  if (process.env.STEAKZ_PRESENTATION_SETUP !== 'true' || process.env.NODE_ENV === 'production') {
    throw new Error('Set STEAKZ_PRESENTATION_SETUP=true in a non-production environment to run this one-time setup.');
  }
  const databasePath = getPresentationDatabasePath(process.env.DATABASE_URL);
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${databasePath.replace(/\\/g, '/')}` } } });
  try {
    const result = await ensurePresentationDeliveryAccounts(prisma, (password, rounds) => bcrypt.hash(password, rounds));
    console.log(JSON.stringify({ database: 'local presentation SQLite', ...result }, null, 2));
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

const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { getPresentationDatabasePath } = require('./setup_presentation_delivery_accounts.cjs');

const EXPECTED_BRANCHES = [
  'Steakz City Centre',
  'Steakz Northside',
  'Steakz Southgate',
  'Steakz Uptown',
];

function prismaFor(databasePath) {
  const databaseUrl = `file:${databasePath.replace(/\\/g, '/')}`;
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

async function assertPresentationDatabase(prisma, databasePath) {
  const databases = await prisma.$queryRaw`PRAGMA database_list`;
  const mainDatabase = databases.find((database) => database.name === 'main');
  const normalizePath = (value) => {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  if (!mainDatabase?.file || normalizePath(mainDatabase.file) !== normalizePath(databasePath)) {
    throw new Error('The active Prisma connection is not the explicitly configured presentation database.');
  }

  const activeBranches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { name: true },
    orderBy: { name: 'asc' },
  });
  const names = activeBranches.map(({ name }) => name).sort();
  const expectedNames = [...EXPECTED_BRANCHES].sort();
  if (names.length !== expectedNames.length
    || names.some((name, index) => name !== expectedNames[index])) {
    throw new Error('Refusing to clear orders unless exactly the four presentation locations are active.');
  }

  const schemaTables = await prisma.$queryRaw`
    SELECT name FROM sqlite_master WHERE type = 'table'
  `;
  const unmodeledOrderTables = schemaTables
    .map(({ name }) => name)
    .filter((name) => /^(payments?|receipts?|notifications?)$/i.test(name));
  if (unmodeledOrderTables.length > 0) {
    throw new Error(`Refusing to clear orders while dependent tables are outside the Prisma schema: ${unmodeledOrderTables.join(', ')}.`);
  }
}

async function snapshot(prisma) {
  const [
    orders,
    orderItems,
    branches,
    users,
    menuItems,
    tables,
    bookings,
    managerAssignments,
    tableStates,
  ] = await Promise.all([
    prisma.order.findMany({
      select: {
        id: true,
        customerId: true,
        bookingId: true,
        branchId: true,
        status: true,
        orderType: true,
        deliveryStatus: true,
        paymentStatus: true,
        assignedDriverId: true,
        assignedAt: true,
        pickedUpAt: true,
        deliveredAt: true,
        checkoutRequestId: true,
        total: true,
        recipientName: true,
        recipientPhone: true,
        deliveryAddress: true,
        deliveryInstructions: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    prisma.orderItem.findMany({
      select: { id: true, orderId: true, menuItemId: true, quantity: true, unitPrice: true },
      orderBy: { id: 'asc' },
    }),
    prisma.branch.findMany({
      select: { id: true, name: true, address: true, isActive: true, designatedDeliveryDriverId: true },
      orderBy: { id: 'asc' },
    }),
    prisma.user.findMany({
      select: { id: true, email: true, password: true, role: true, branchId: true, isActive: true },
      orderBy: { id: 'asc' },
    }),
    prisma.menuItem.findMany({
      select: { id: true, name: true, price: true, category: true, isAvailable: true, branchId: true },
      orderBy: { id: 'asc' },
    }),
    prisma.table.findMany({
      select: { id: true, tableNumber: true, capacity: true, isAvailable: true, status: true, branchId: true },
      orderBy: { id: 'asc' },
    }),
    prisma.booking.findMany({
      select: { id: true, customerId: true, tableId: true, guestCount: true, date: true, status: true },
      orderBy: { id: 'asc' },
    }),
    prisma.branchManagerAssignment.findMany({
      select: { userId: true, branchId: true },
      orderBy: [{ userId: 'asc' }, { branchId: 'asc' }],
    }),
    prisma.table.findMany({
      select: { id: true, status: true, isAvailable: true },
      orderBy: { id: 'asc' },
    }),
  ]);
  return {
    orders,
    orderItems,
    branches,
    users,
    menuItems,
    tables,
    bookings,
    managerAssignments,
    tableStates,
  };
}

async function createVerifiedBackup(prisma, databasePath, expectedSnapshot) {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const backupPath = path.join(
    path.dirname(databasePath),
    `${path.basename(databasePath)}.backup.${timestamp}`,
  );
  if (fs.existsSync(backupPath)) {
    throw new Error(`Refusing to overwrite existing backup: ${backupPath}`);
  }

  const escapedPath = backupPath.replace(/'/g, "''");
  await prisma.$executeRawUnsafe(`VACUUM INTO '${escapedPath}'`);
  if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
    throw new Error('SQLite did not create a usable presentation database backup.');
  }

  const backupPrisma = prismaFor(backupPath);
  try {
    const integrity = await backupPrisma.$queryRaw`PRAGMA integrity_check`;
    const integrityResult = Object.values(integrity[0] ?? {})[0];
    if (integrityResult !== 'ok') {
      throw new Error(`Presentation database backup failed integrity_check: ${String(integrityResult)}`);
    }
    const backupSnapshot = await snapshot(backupPrisma);
    if (JSON.stringify(backupSnapshot) !== JSON.stringify(expectedSnapshot)) {
      throw new Error('Presentation database backup does not match the pre-cleanup data snapshot.');
    }
  } finally {
    await backupPrisma.$disconnect();
  }

  return backupPath;
}

async function clearPresentationOrders(prisma, databasePath) {
  await assertPresentationDatabase(prisma, databasePath);
  const before = await snapshot(prisma);
  const backupPath = await createVerifiedBackup(prisma, databasePath, before);

  await prisma.$transaction(async (transaction) => {
    const current = await snapshot(transaction);
    if (JSON.stringify(current) !== JSON.stringify(before)) {
      throw new Error('Presentation data changed after the backup; no orders were deleted.');
    }

    await transaction.order.deleteMany({});
    const after = await snapshot(transaction);
    if (after.orders.length !== 0 || after.orderItems.length !== 0) {
      throw new Error('Order cleanup left orders or dependent order items behind.');
    }
    if (JSON.stringify(after.branches) !== JSON.stringify(before.branches)
      || JSON.stringify(after.users) !== JSON.stringify(before.users)
      || JSON.stringify(after.menuItems) !== JSON.stringify(before.menuItems)
      || JSON.stringify(after.tables) !== JSON.stringify(before.tables)
      || JSON.stringify(after.bookings) !== JSON.stringify(before.bookings)
      || JSON.stringify(after.managerAssignments) !== JSON.stringify(before.managerAssignments)
      || JSON.stringify(after.tableStates) !== JSON.stringify(before.tableStates)) {
      throw new Error('Order cleanup changed retained accounts, locations, menus, tables, reservations, or table states.');
    }
  });

  return {
    database: databasePath,
    backup: backupPath,
    deletedOrders: before.orders.length,
    deletedOrderItems: before.orderItems.length,
    remainingOrders: 0,
    remainingOrderItems: 0,
    preservedBranches: before.branches.length,
    preservedUsers: before.users.length,
    preservedMenuItems: before.menuItems.length,
    preservedTables: before.tables.length,
    preservedBookings: before.bookings.length,
  };
}

async function main() {
  if (process.env.STEAKZ_PRESENTATION_ORDER_CLEANUP !== 'true'
    || process.env.NODE_ENV === 'production') {
    throw new Error(
      'Set STEAKZ_PRESENTATION_ORDER_CLEANUP=true in a non-production environment to run this explicit one-time operation.',
    );
  }
  if (!process.env.DATABASE_URL?.startsWith('file:')) {
    throw new Error('DATABASE_URL must point to the local SQLite presentation database.');
  }

  const databasePath = getPresentationDatabasePath(process.env.DATABASE_URL);
  const prisma = prismaFor(databasePath);
  try {
    const result = await clearPresentationOrders(prisma, databasePath);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

module.exports = {
  EXPECTED_BRANCHES,
  assertPresentationDatabase,
  clearPresentationOrders,
  createVerifiedBackup,
  snapshot,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

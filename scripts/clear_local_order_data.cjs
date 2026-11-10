const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdir, readFile, stat } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
const requiredConfirmation = '--confirm-clear-local-orders';
const preservedTables = [
  'User',
  'Branch',
  'BranchManagerAssignment',
  'MenuItem',
  'Booking',
];

function quoteIdentifier(identifier) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function resolveConfiguredDatabase(envContents) {
  const parsed = dotenv.parse(envContents);
  const databaseUrl = parsed.DATABASE_URL?.trim();
  if (!databaseUrl?.toLowerCase().startsWith('file:')) {
    throw new Error('The root .env must configure a local SQLite database.');
  }

  const databasePath = path.resolve(fileURLToPath(new URL(databaseUrl)));
  const expectedPath = path.resolve(root, 'backend', 'prisma', 'dev.db');
  if (databasePath.toLowerCase() !== expectedPath.toLowerCase()) {
    throw new Error('The root .env database path is not this checkout’s canonical presentation database.');
  }
  return databasePath;
}

function assertHealthyDatabase(database) {
  const integrity = database.prepare('PRAGMA integrity_check').all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
    throw new Error(`SQLite integrity check failed: ${JSON.stringify(integrity)}`);
  }
  const violations = database.prepare('PRAGMA foreign_key_check').all();
  if (violations.length !== 0) {
    throw new Error(`SQLite foreign key check failed: ${JSON.stringify(violations)}`);
  }
}

function getOrderDependencies(database) {
  const tables = database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map((row) => row.name);
  const dependencies = [];
  const suspiciousUnlinkedTables = [];

  for (const tableName of tables) {
    if (tableName === 'Order') continue;
    const foreignKeys = database.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(tableName)})`).all();
    const orderKeys = foreignKeys.filter((foreignKey) => foreignKey.table === 'Order');
    if (orderKeys.length > 0) {
      const groups = new Map();
      for (const foreignKey of orderKeys) {
        const group = groups.get(foreignKey.id) ?? [];
        group.push(foreignKey);
        groups.set(foreignKey.id, group);
      }
      for (const group of groups.values()) {
        if (group.length !== 1) {
          throw new Error(`Composite order dependency in ${tableName} needs an explicit cleanup rule.`);
        }
        dependencies.push({ tableName, ...group[0] });
      }
    } else if (/(order|receipt|payment|notification|order.?status.?history)/i.test(tableName)) {
      suspiciousUnlinkedTables.push(tableName);
    }
  }

  if (suspiciousUnlinkedTables.length > 0) {
    throw new Error(
      `Inspect these possible order-related tables before cleanup: ${suspiciousUnlinkedTables.join(', ')}`,
    );
  }
  return dependencies;
}

function snapshotPreservedData(database) {
  const snapshots = {};
  for (const tableName of preservedTables) {
    const rows = database.prepare(`SELECT * FROM ${quoteIdentifier(tableName)} ORDER BY rowid`).all();
    snapshots[tableName] = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
  }

  const tableColumns = database.prepare('PRAGMA table_info("Table")').all()
    .map((column) => column.name)
    .filter((name) => name !== 'status');
  const tableRows = database.prepare(
    `SELECT ${tableColumns.map(quoteIdentifier).join(', ')} FROM "Table" ORDER BY rowid`,
  ).all();
  snapshots.Table = createHash('sha256').update(JSON.stringify(tableRows)).digest('hex');
  return snapshots;
}

function getCounts(database, dependencies) {
  const counts = {
    orders: database.prepare('SELECT COUNT(*) AS count FROM "Order"').get().count,
    orderItems: database.prepare('SELECT COUNT(*) AS count FROM OrderItem').get().count,
    paymentEvents: database.prepare('SELECT COUNT(*) AS count FROM PaymentEvent').get().count,
    assignedDeliveries: database.prepare(
      'SELECT COUNT(*) AS count FROM "Order" WHERE assignedDriverId IS NOT NULL',
    ).get().count,
    receipts: database.prepare(
      'SELECT COUNT(*) AS count FROM "Order" WHERE paymentStatus = ?',
    ).get('PAID').count,
  };
  counts.dependentRecords = {};
  for (const dependency of dependencies) {
    const query = `SELECT COUNT(*) AS count FROM ${quoteIdentifier(dependency.tableName)}
      WHERE ${quoteIdentifier(dependency.from)} IN (
        SELECT ${quoteIdentifier(dependency.to)} FROM "Order"
      )`;
    counts.dependentRecords[dependency.tableName] = database.prepare(query).get().count;
  }
  return counts;
}

async function createBackupAndClearOrders(databasePath, backupDirectory) {
  const backupDirectoryPath = path.resolve(backupDirectory);
  const relativeBackupDirectory = path.relative(root, backupDirectoryPath);
  if (!relativeBackupDirectory.startsWith('..') && !path.isAbsolute(relativeBackupDirectory)) {
    throw new Error('The restorable backup must be stored outside the Git checkout.');
  }

  const database = new DatabaseSync(databasePath);
  database.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;');
  let transactionOpen = false;

  try {
    assertHealthyDatabase(database);
    const dependencies = getOrderDependencies(database);
    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).all().map((row) => row.name);
    if (!tables.includes('Order') || !tables.includes('OrderItem') || !tables.includes('PaymentEvent')
      || !tables.includes('Table') || !tables.includes('Booking')) {
      throw new Error('The database schema is missing expected local order or booking tables.');
    }

    const before = getCounts(database, dependencies);
    const preservedBefore = snapshotPreservedData(database);
    await mkdir(backupDirectoryPath, { recursive: true });
    const backupName = `steakz-orders-before-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
    const backupPath = path.join(backupDirectoryPath, backupName);
    database.exec(`VACUUM INTO ${quoteLiteral(backupPath)}`);

    const backupStats = await stat(backupPath);
    if (!backupStats.isFile() || backupStats.size === 0) {
      throw new Error(`The database backup is missing or empty: ${backupPath}`);
    }
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    try {
      assertHealthyDatabase(backup);
      assert.deepEqual(getCounts(backup, dependencies), before, 'Backup does not contain the original order data.');
    } finally {
      backup.close();
    }

    let tableStatusesUpdated;
    try {
      database.exec('BEGIN IMMEDIATE');
      transactionOpen = true;

      for (const dependency of dependencies) {
        const query = `DELETE FROM ${quoteIdentifier(dependency.tableName)}
          WHERE ${quoteIdentifier(dependency.from)} IN (
            SELECT ${quoteIdentifier(dependency.to)} FROM "Order"
          )`;
        database.exec(query);
      }
      database.exec('DELETE FROM "OrderItem"');
      database.exec('DELETE FROM "Order"');

      tableStatusesUpdated = database.prepare(`
        UPDATE "Table"
        SET status = CASE
          WHEN EXISTS (
            SELECT 1 FROM Booking
            WHERE Booking.tableId = "Table".id AND Booking.status = 'CONFIRMED'
          ) THEN 'OCCUPIED'
          WHEN EXISTS (
            SELECT 1 FROM Booking
            WHERE Booking.tableId = "Table".id AND Booking.status = 'PENDING'
          ) THEN 'RESERVED'
          WHEN status IN ('OCCUPIED', 'RESERVED') THEN 'AVAILABLE'
          ELSE status
        END
        WHERE status IN ('OCCUPIED', 'RESERVED', 'CLEANING')
          OR EXISTS (
            SELECT 1 FROM Booking
            WHERE Booking.tableId = "Table".id AND Booking.status IN ('PENDING', 'CONFIRMED')
          )
      `).run().changes;

      const after = getCounts(database, dependencies);
      for (const [tableName, count] of Object.entries(after.dependentRecords)) {
        if (count !== 0) throw new Error(`Order-dependent records remain in ${tableName}.`);
      }
      if (after.orders !== 0 || after.orderItems !== 0 || after.paymentEvents !== 0
        || after.assignedDeliveries !== 0 || after.receipts !== 0) {
        throw new Error(`Order cleanup did not clear all order data: ${JSON.stringify(after)}`);
      }
      assert.deepEqual(snapshotPreservedData(database), preservedBefore,
        'The cleanup changed account, branch, menu, booking, or non-status table data.');
      assertHealthyDatabase(database);
      database.exec('COMMIT');
      transactionOpen = false;

      return {
        databasePath: path.resolve(databasePath),
        backupPath,
        before,
        after,
        tableStatusesUpdated,
        foreignKeyViolations: 0,
        preservedTablesVerified: [...preservedTables, 'Table (except reconciled status)'],
      };
    } catch (error) {
      if (transactionOpen) {
        database.exec('ROLLBACK');
        transactionOpen = false;
      }
      throw error;
    }
  } finally {
    database.close();
  }
}

async function runCli() {
  if (!process.argv.includes(requiredConfirmation)) {
    throw new Error(
      `This is a one-time destructive operation. Review the local database, then rerun with ${requiredConfirmation}.`,
    );
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to clear order data in production.');
  }

  const envPath = path.join(root, '.env');
  const envContents = await readFile(envPath, 'utf8');
  const databasePath = resolveConfiguredDatabase(envContents);
  const backupDirectory = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'Steakz',
    'backups',
  );
  const result = await createBackupAndClearOrders(databasePath, backupDirectory);
  console.log(JSON.stringify(result, null, 2));
}

module.exports = { createBackupAndClearOrders, resolveConfiguredDatabase };

if (require.main === module) {
  runCli().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

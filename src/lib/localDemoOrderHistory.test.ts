import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createActiveOrderWhere,
  createOrderHistoryWhere,
  isLocalDemoOrderHistoryEnabled,
  readLocalDemoOrderCutoff,
  setLocalDemoOrderCutoff,
} from './localDemoOrderHistory.js';

test('order-history cutoff excludes old terminal orders while preserving active orders', () => {
  const cutoffAt = new Date('2026-11-10T07:00:00.000Z');
  assert.deepEqual(createOrderHistoryWhere(null), {});
  assert.deepEqual(createOrderHistoryWhere(cutoffAt), {
    OR: [
      { createdAt: { gte: cutoffAt } },
      createActiveOrderWhere(),
    ],
  });
});

test('active orders must not be cancelled, delivered, or already delivered by a driver', () => {
  assert.deepEqual(createActiveOrderWhere(), {
    status: { notIn: ['CANCELLED', 'DELIVERED'] },
    OR: [
      { deliveryStatus: null },
      { deliveryStatus: { not: 'DELIVERED' } },
    ],
  });
});

test('local demo cutoff persists and can be restored without touching a database', async () => {
  const originalCwd = process.cwd();
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalEnabled = process.env.LOCAL_DEMO_ORDER_HISTORY_ENABLED;
  const originalNodeEnv = process.env.NODE_ENV;
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'steakz-demo-history-'));

  try {
    process.chdir(temporaryDirectory);
    process.env.DATABASE_URL = 'file:./dev.db';
    process.env.LOCAL_DEMO_ORDER_HISTORY_ENABLED = 'true';
    delete process.env.NODE_ENV;

    assert.equal(isLocalDemoOrderHistoryEnabled(), true);
    assert.equal(await readLocalDemoOrderCutoff(), null);

    const cutoffAt = new Date('2026-11-10T07:00:00.000Z');
    await setLocalDemoOrderCutoff(cutoffAt);
    assert.equal((await readLocalDemoOrderCutoff())?.toISOString(), cutoffAt.toISOString());
    assert.match(await readFile('.steakz-demo-order-history.json', 'utf8'), /2026-11-10T07:00:00\.000Z/);

    await setLocalDemoOrderCutoff(null);
    assert.equal(await readLocalDemoOrderCutoff(), null);

    process.env.NODE_ENV = 'production';
    assert.equal(isLocalDemoOrderHistoryEnabled(), false);
    await assert.rejects(setLocalDemoOrderCutoff(cutoffAt), /only available for the configured local SQLite app/);
  } finally {
    process.chdir(originalCwd);
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalEnabled === undefined) delete process.env.LOCAL_DEMO_ORDER_HISTORY_ENABLED;
    else process.env.LOCAL_DEMO_ORDER_HISTORY_ENABLED = originalEnabled;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

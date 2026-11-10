import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';

interface PersistedDemoOrderHistory {
  cutoffAt: string | null;
}

function getSettingsPath() {
  return path.join(process.cwd(), '.steakz-demo-order-history.json');
}

export function isLocalDemoOrderHistoryEnabled() {
  return process.env.LOCAL_DEMO_ORDER_HISTORY_ENABLED === 'true'
    && process.env.NODE_ENV !== 'production'
    && process.env.DATABASE_URL?.trim().toLowerCase().startsWith('file:') === true;
}

export function createOrderHistoryWhere(cutoffAt: Date | null): Prisma.OrderWhereInput {
  if (!cutoffAt) return {};

  return {
    OR: [
      { createdAt: { gte: cutoffAt } },
      createActiveOrderWhere(),
    ],
  };
}

export function createActiveOrderWhere(): Prisma.OrderWhereInput {
  return {
    status: { notIn: ['CANCELLED', 'DELIVERED'] },
    OR: [
      { deliveryStatus: null },
      { deliveryStatus: { not: 'DELIVERED' } },
    ],
  };
}

export async function readLocalDemoOrderCutoff(): Promise<Date | null> {
  if (!isLocalDemoOrderHistoryEnabled()) return null;

  let contents: string;
  try {
    contents = await readFile(getSettingsPath(), 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }

  const settings = JSON.parse(contents) as Partial<PersistedDemoOrderHistory>;
  if (settings.cutoffAt === null) return null;
  if (typeof settings.cutoffAt !== 'string') {
    throw new Error('Local demo order history settings have an invalid cutoffAt value.');
  }

  const cutoffAt = new Date(settings.cutoffAt);
  if (Number.isNaN(cutoffAt.getTime())) {
    throw new Error('Local demo order history settings contain an invalid cutoff timestamp.');
  }
  return cutoffAt;
}

export async function getOrderHistoryWhere(): Promise<Prisma.OrderWhereInput> {
  return createOrderHistoryWhere(await readLocalDemoOrderCutoff());
}

export async function setLocalDemoOrderCutoff(cutoffAt: Date | null): Promise<void> {
  if (!isLocalDemoOrderHistoryEnabled()) {
    throw new Error('Local demo order history is only available for the configured local SQLite app.');
  }
  if (cutoffAt && Number.isNaN(cutoffAt.getTime())) {
    throw new Error('A valid cutoff timestamp is required.');
  }

  const settingsPath = getSettingsPath();
  const temporaryPath = `${settingsPath}.${process.pid}.${randomUUID()}.tmp`;
  const settings: PersistedDemoOrderHistory = { cutoffAt: cutoffAt?.toISOString() ?? null };
  await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, settingsPath);
}

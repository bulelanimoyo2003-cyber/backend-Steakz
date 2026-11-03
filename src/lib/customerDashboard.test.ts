import assert from 'node:assert/strict';
import test from 'node:test';
import { loadCustomerDashboard } from './customerDashboard.js';

test('a failed customer section does not discard other successful sections', async () => {
  const results = await loadCustomerDashboard({
    bookings: async () => [{ id: 1 }],
    orders: async () => {
      throw new Error('orders unavailable');
    },
    receipts: async () => [{ orderId: 3 }],
  });

  assert.deepEqual(results.bookings, { ok: true, value: [{ id: 1 }] });
  assert.equal(results.orders.ok, false);
  assert.deepEqual(results.receipts, { ok: true, value: [{ orderId: 3 }] });
});

test('empty customer sections are successful empty results, not failures', async () => {
  const results = await loadCustomerDashboard({
    bookings: async () => [],
    orders: async () => [],
    receipts: async () => [],
  });

  assert.deepEqual(results, {
    bookings: { ok: true, value: [] },
    orders: { ok: true, value: [] },
    receipts: { ok: true, value: [] },
  });
});

test('each failed customer section retains its error for honest reporting', async () => {
  const bookingsError = new Error('bookings unavailable');
  const receiptsError = new Error('receipts unavailable');
  const results = await loadCustomerDashboard({
    bookings: async () => {
      throw bookingsError;
    },
    orders: async () => [],
    receipts: async () => {
      throw receiptsError;
    },
  });

  assert.deepEqual(results.bookings, { ok: false, error: bookingsError });
  assert.deepEqual(results.orders, { ok: true, value: [] });
  assert.deepEqual(results.receipts, { ok: false, error: receiptsError });
});

test('missing dashboard sections are reported as failures instead of crashing', async () => {
  const results = await loadCustomerDashboard({
    bookings: undefined as any,
    orders: async () => [],
    receipts: undefined as any,
  });

  assert.equal(results.bookings.ok, false);
  assert.equal(results.orders.ok, true);
  assert.equal(results.receipts.ok, false);
});

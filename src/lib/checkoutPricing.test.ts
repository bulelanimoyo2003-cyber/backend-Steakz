import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCheckoutAmounts } from './checkoutPricing.js';

test('checkout totals are calculated in cents from server-supplied menu prices', () => {
  assert.deepEqual(calculateCheckoutAmounts([
    { menuItemId: 1, quantity: 2, price: 12.35 },
    { menuItemId: 2, quantity: 1, price: 4.1 },
  ], 'DELIVERY'), {
    subtotal: 28.8,
    discountTotal: 0,
    deliveryFee: 0,
    total: 28.8,
    currency: 'EUR',
  });
});

test('configured discounts and delivery charges remain explicit zero values', () => {
  const amounts = calculateCheckoutAmounts([
    { menuItemId: 1, quantity: 1, price: 1.005 },
  ], 'COLLECTION');
  assert.equal(amounts.subtotal, 1.01);
  assert.equal(amounts.discountTotal, 0);
  assert.equal(amounts.deliveryFee, 0);
  assert.equal(amounts.total, 1.01);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { isSameCheckoutRequest, type CheckoutSnapshot } from './orderIdempotency.js';

const checkout: CheckoutSnapshot = {
  customerId: 7,
  branchId: 3,
  bookingId: null,
  orderType: 'DELIVERY',
  recipientName: 'Test Recipient',
  recipientPhone: '+12345678901',
  deliveryAddress: 'Test Address',
  deliveryInstructions: null,
  items: [
    { menuItemId: 11, quantity: 2, unitPrice: 15 },
    { menuItemId: 12, quantity: 1, unitPrice: 8 },
  ],
};

test('checkout retries match the same customer, branch, details, and items independent of item order', () => {
  assert.equal(isSameCheckoutRequest(checkout, {
    ...checkout,
    items: [...checkout.items].reverse(),
  }), true);
});

test('an idempotency key cannot silently reuse an order for different checkout data', () => {
  assert.equal(isSameCheckoutRequest(checkout, { ...checkout, customerId: 8 }), false);
  assert.equal(isSameCheckoutRequest(checkout, { ...checkout, branchId: 4 }), false);
  assert.equal(isSameCheckoutRequest(checkout, { ...checkout, deliveryAddress: 'Different address' }), false);
  assert.equal(isSameCheckoutRequest(checkout, {
    ...checkout,
    items: [{ menuItemId: 11, quantity: 3, unitPrice: 15 }],
  }), false);
});

test('malformed checkout payloads are rejected instead of comparing partial data', () => {
  assert.equal(isSameCheckoutRequest(checkout as any, { ...checkout, items: [{ menuItemId: 11, quantity: 0, unitPrice: 15 }] }), false);
  assert.equal(isSameCheckoutRequest(checkout as any, { ...checkout, items: [{ menuItemId: 11, quantity: 2, unitPrice: 15 }, { menuItemId: 11, quantity: 2, unitPrice: 15 }] }), false);
  assert.equal(isSameCheckoutRequest(null as any, checkout), false);
});

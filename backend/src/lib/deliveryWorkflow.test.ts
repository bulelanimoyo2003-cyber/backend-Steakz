import assert from 'node:assert/strict';
import test from 'node:test';
import { canCompleteDelivery, canPickUpDelivery, type DeliveryOrderState } from './deliveryWorkflow.js';

const order: DeliveryOrderState = {
  branchId: 2,
  status: 'DONE',
  paymentStatus: 'PAID',
  orderType: 'DELIVERY',
  deliveryStatus: 'ASSIGNED',
  assignedDriverId: 9,
};

test('delivery collection requires completed preparation and paid status', () => {
  assert.equal(canPickUpDelivery(order), true);
  assert.equal(canPickUpDelivery({ ...order, status: 'PREPARING' }), false);
  assert.equal(canPickUpDelivery({ ...order, paymentStatus: 'UNPAID' }), false);
});

test('delivery completion requires the assigned delivery to be out for delivery', () => {
  assert.equal(canCompleteDelivery({ ...order, deliveryStatus: 'OUT_FOR_DELIVERY' }), true);
  assert.equal(canCompleteDelivery(order), false);
});

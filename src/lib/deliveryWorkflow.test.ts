import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessAssignedDelivery,
  canAssignDelivery,
  canCompleteDelivery,
  canManageDeliveryOrder,
  canPickUpDelivery,
  isEligibleDeliveryDriver,
  type DeliveryActor,
  type DeliveryDriver,
  type DeliveryOrderState,
} from './deliveryWorkflow.js';

const order: DeliveryOrderState = {
  branchId: 4,
  status: 'DONE',
  orderType: 'DELIVERY',
  deliveryStatus: 'ASSIGNED',
  assignedDriverId: 12,
};

test('delivery access is limited to assigned drivers and manager scope', () => {
  assert.equal(canAccessAssignedDelivery({ id: 12, role: 'DELIVERY_DRIVER', branchId: 4 }, order), true);
  assert.equal(canAccessAssignedDelivery({ id: 13, role: 'DELIVERY_DRIVER', branchId: 4 }, order), false);
  assert.equal(canManageDeliveryOrder({ id: 1, role: 'BRANCH_MANAGER', branchId: 4 }, order), true);
  assert.equal(canManageDeliveryOrder({ id: 2, role: 'BRANCH_MANAGER', branchId: 5 }, order), false);
  assert.equal(canManageDeliveryOrder({ id: 3, role: 'HQ_MANAGER', branchId: null }, order), true);
  assert.equal(canManageDeliveryOrder({ id: 4, role: 'ADMIN', branchId: null }, order), true);
});

test('only active same-branch delivery drivers are eligible for assignment', () => {
  const driver: DeliveryDriver = { id: 12, role: 'DELIVERY_DRIVER', branchId: 4, isActive: true };
  assert.equal(isEligibleDeliveryDriver(driver, order), true);
  assert.equal(isEligibleDeliveryDriver({ ...driver, branchId: 5 }, order), false);
  assert.equal(isEligibleDeliveryDriver({ ...driver, isActive: false }, order), false);
  assert.equal(isEligibleDeliveryDriver({ ...driver, role: 'CHEF' }, order), false);
});

test('delivery transitions require kitchen completion and valid delivery progress', () => {
  assert.equal(canAssignDelivery(order), true);
  assert.equal(canPickUpDelivery(order), true);
  assert.equal(canCompleteDelivery(order), false);

  const outForDelivery = { ...order, deliveryStatus: 'OUT_FOR_DELIVERY' };
  assert.equal(canAssignDelivery(outForDelivery), false);
  assert.equal(canPickUpDelivery(outForDelivery), false);
  assert.equal(canCompleteDelivery(outForDelivery), true);

  assert.equal(canAssignDelivery({ ...order, status: 'CANCELLED' }), false);
  assert.equal(canAssignDelivery({ ...order, deliveryStatus: 'DELIVERED' }), false);
  assert.equal(canPickUpDelivery({ ...order, status: 'PREPARING' }), false);
  assert.equal(canCompleteDelivery({ ...order, status: 'CANCELLED' }), false);
});

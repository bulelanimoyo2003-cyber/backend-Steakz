export interface DeliveryOrderState {
  branchId: number;
  status: string;
  paymentStatus: string;
  orderType: string;
  deliveryStatus: string | null;
  assignedDriverId: number | null;
}

export interface DeliveryActor {
  id: number;
  role: string;
  branchId: number | null;
  managedBranchIds?: number[];
}

export interface DeliveryDriver {
  id: number;
  role: string;
  branchId: number | null;
  isActive: boolean;
}

export function canManageDeliveryOrder(actor: DeliveryActor, order: DeliveryOrderState): boolean {
  return actor.role === 'ADMIN' || actor.role === 'HQ_MANAGER'
    || (actor.role === 'BRANCH_MANAGER'
      && (actor.branchId === order.branchId || actor.managedBranchIds?.includes(order.branchId) === true));
}

export function canAccessAssignedDelivery(actor: DeliveryActor, order: DeliveryOrderState): boolean {
  return actor.role === 'DELIVERY_DRIVER' && order.assignedDriverId === actor.id;
}

export function isEligibleDeliveryDriver(driver: DeliveryDriver, order: DeliveryOrderState): boolean {
  return driver.role === 'DELIVERY_DRIVER' && driver.isActive && driver.branchId === order.branchId;
}

export function canAssignDelivery(order: DeliveryOrderState): boolean {
  return order.orderType === 'DELIVERY'
    && order.status !== 'CANCELLED'
    && order.status !== 'DELIVERED'
    && (order.deliveryStatus === null || order.deliveryStatus === 'ASSIGNED');
}

export function canPickUpDelivery(order: DeliveryOrderState): boolean {
  return order.orderType === 'DELIVERY'
    && order.status === 'DONE'
    && order.paymentStatus === 'PAID'
    && order.deliveryStatus === 'ASSIGNED';
}

export function canCompleteDelivery(order: DeliveryOrderState): boolean {
  return order.orderType === 'DELIVERY'
    && order.status === 'DONE'
    && order.deliveryStatus === 'OUT_FOR_DELIVERY';
}

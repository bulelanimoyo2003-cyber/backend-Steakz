export interface CheckoutItemSnapshot {
  menuItemId: number;
  quantity: number;
  unitPrice: number;
}

export interface CheckoutSnapshot {
  customerId: number | null;
  branchId: number;
  bookingId: number | null;
  orderType: string;
  recipientName: string | null;
  recipientPhone: string | null;
  deliveryAddress: string | null;
  deliveryInstructions: string | null;
  items: CheckoutItemSnapshot[];
}

export function isSameCheckoutRequest(existing: CheckoutSnapshot, requested: CheckoutSnapshot): boolean {
  if (existing.customerId !== requested.customerId
    || existing.branchId !== requested.branchId
    || existing.bookingId !== requested.bookingId
    || existing.orderType !== requested.orderType
    || existing.recipientName !== requested.recipientName
    || existing.recipientPhone !== requested.recipientPhone
    || existing.deliveryAddress !== requested.deliveryAddress
    || existing.deliveryInstructions !== requested.deliveryInstructions
    || existing.items.length !== requested.items.length) {
    return false;
  }
  const left = [...existing.items].sort((a, b) => a.menuItemId - b.menuItemId);
  const right = [...requested.items].sort((a, b) => a.menuItemId - b.menuItemId);
  return left.every((item, index) => {
    const other = right[index];
    return other !== undefined && item.menuItemId === other.menuItemId
      && item.quantity === other.quantity && item.unitPrice === other.unitPrice;
  });
}

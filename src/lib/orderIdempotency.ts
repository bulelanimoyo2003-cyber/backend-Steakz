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
  if (
    existing.customerId !== requested.customerId
    || existing.branchId !== requested.branchId
    || existing.bookingId !== requested.bookingId
    || existing.orderType !== requested.orderType
    || existing.recipientName !== requested.recipientName
    || existing.recipientPhone !== requested.recipientPhone
    || existing.deliveryAddress !== requested.deliveryAddress
    || existing.deliveryInstructions !== requested.deliveryInstructions
    || existing.items.length !== requested.items.length
  ) {
    return false;
  }

  const existingItems = [...existing.items].sort((a, b) => a.menuItemId - b.menuItemId);
  const requestedItems = [...requested.items].sort((a, b) => a.menuItemId - b.menuItemId);
  return existingItems.every((item, index) => {
    const requestedItem = requestedItems[index];
    if (!requestedItem) return false;
    return item.menuItemId === requestedItem.menuItemId
      && item.quantity === requestedItem.quantity
      && item.unitPrice === requestedItem.unitPrice;
  });
}

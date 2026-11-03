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
  if (!existing || !requested || typeof existing !== 'object' || typeof requested !== 'object') {
    return false;
  }

  if (
    existing.customerId !== requested.customerId
    || existing.branchId !== requested.branchId
    || existing.bookingId !== requested.bookingId
    || existing.orderType !== requested.orderType
    || existing.recipientName !== requested.recipientName
    || existing.recipientPhone !== requested.recipientPhone
    || existing.deliveryAddress !== requested.deliveryAddress
    || existing.deliveryInstructions !== requested.deliveryInstructions
    || !Array.isArray(existing.items)
    || !Array.isArray(requested.items)
    || existing.items.length !== requested.items.length
  ) {
    return false;
  }

  const normalizeItems = (items: CheckoutItemSnapshot[]) => items.map((item) => ({
    menuItemId: Number(item?.menuItemId),
    quantity: Number(item?.quantity),
    unitPrice: Number(item?.unitPrice),
  })).filter((item) => Number.isInteger(item.menuItemId) && item.menuItemId > 0
    && Number.isInteger(item.quantity) && item.quantity > 0
    && Number.isFinite(item.unitPrice));

  const existingItems = [...normalizeItems(existing.items)].sort((a, b) => a.menuItemId - b.menuItemId);
  const requestedItems = [...normalizeItems(requested.items)].sort((a, b) => a.menuItemId - b.menuItemId);

  if (existingItems.length !== requestedItems.length) {
    return false;
  }

  return existingItems.every((item, index) => {
    const requestedItem = requestedItems[index];
    if (!requestedItem) return false;
    return item.menuItemId === requestedItem.menuItemId
      && item.quantity === requestedItem.quantity
      && item.unitPrice === requestedItem.unitPrice;
  });
}

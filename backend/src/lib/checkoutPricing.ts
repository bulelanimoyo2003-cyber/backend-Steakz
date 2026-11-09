export interface CheckoutLine {
  menuItemId: number;
  quantity: number;
  price: number;
}

export interface CheckoutAmounts {
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  total: number;
  currency: 'EUR';
}

export function roundPrice(price: number): number {
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('Menu prices must be finite, non-negative amounts.');
  }
  return Math.round((price + Number.EPSILON) * 100) / 100;
}

export function calculateCheckoutAmounts(lines: CheckoutLine[], _orderType: string): CheckoutAmounts {
  const subtotalCents = lines.reduce(
    (sum, line) => sum + Math.round((line.price + Number.EPSILON) * 100) * line.quantity,
    0,
  );
  const discountCents = 0;
  const deliveryCents = 0;
  return {
    subtotal: subtotalCents / 100,
    discountTotal: discountCents / 100,
    deliveryFee: deliveryCents / 100,
    total: (subtotalCents - discountCents + deliveryCents) / 100,
    currency: 'EUR',
  };
}

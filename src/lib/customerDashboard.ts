export type SectionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

export interface CustomerDashboardResults<TBooking, TOrder, TReceipt> {
  bookings: SectionResult<TBooking>;
  orders: SectionResult<TOrder>;
  receipts: SectionResult<TReceipt>;
}

export async function loadCustomerDashboard<TBooking, TOrder, TReceipt>(
  requests: {
    bookings: () => Promise<TBooking>;
    orders: () => Promise<TOrder>;
    receipts: () => Promise<TReceipt>;
  },
): Promise<CustomerDashboardResults<TBooking, TOrder, TReceipt>> {
  const [bookings, orders, receipts] = await Promise.allSettled([
    requests.bookings(),
    requests.orders(),
    requests.receipts(),
  ]);

  const toResult = <T>(result: PromiseSettledResult<T>): SectionResult<T> =>
    result.status === 'fulfilled'
      ? { ok: true, value: result.value }
      : { ok: false, error: result.reason };

  return {
    bookings: toResult(bookings),
    orders: toResult(orders),
    receipts: toResult(receipts),
  };
}

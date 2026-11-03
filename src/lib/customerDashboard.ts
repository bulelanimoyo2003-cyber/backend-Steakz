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
  const loadSection = async <T>(sectionName: 'bookings' | 'orders' | 'receipts', request: unknown): Promise<PromiseSettledResult<T>> => {
    if (typeof request !== 'function') {
      return {
        status: 'rejected',
        reason: new TypeError(`Dashboard section "${sectionName}" is not a function.`),
      };
    }

    try {
      return { status: 'fulfilled', value: await request() as T };
    } catch (error) {
      return { status: 'rejected', reason: error };
    }
  };

  const [bookings, orders, receipts] = await Promise.all([
    loadSection<TBooking>('bookings', requests.bookings),
    loadSection<TOrder>('orders', requests.orders),
    loadSection<TReceipt>('receipts', requests.receipts),
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

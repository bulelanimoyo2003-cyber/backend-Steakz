export async function loadCustomerDashboard(requests) {
    const [bookings, orders, receipts] = await Promise.allSettled([
        requests.bookings(),
        requests.orders(),
        requests.receipts(),
    ]);
    const toResult = (result) => result.status === 'fulfilled'
        ? { ok: true, value: result.value }
        : { ok: false, error: result.reason };
    return {
        bookings: toResult(bookings),
        orders: toResult(orders),
        receipts: toResult(receipts),
    };
}

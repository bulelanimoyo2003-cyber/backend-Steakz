import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import { loadCustomerDashboard } from '../../../src/lib/customerDashboard';

interface Booking {
  id: number;
  date: string;
  status: string;
  guestCount: number;
  table: { tableNumber: number; branch: { name: string } };
}

interface OrderItem {
  menuItem: { name: string };
  quantity: number;
}

interface Order {
  id: number;
  total: number;
  status: string;
  orderType: string;
  deliveryStatus: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryInstructions?: string | null;
  assignedDriver?: { id: number; name: string } | null;
  deliveredAt?: string | null;
  paymentStatus?: string;
  createdAt: string;
  branch: { name: string };
  items: OrderItem[];
}

interface ReceiptSummary {
  orderId: number;
  receiptNumber: string;
  branchName: string | null;
  dateTime: string;
  totalAmount: number;
  paymentStatus: string;
  orderType: string;
  deliveryStatus: string | null;
  deliveredAt: string | null;
}

export default function CustomerDashboard() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [receipts, setReceipts] = useState<ReceiptSummary[]>([]);
  const [loadErrors, setLoadErrors] = useState({ bookings: false, orders: false, receipts: false });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setBookings([]);
    setOrders([]);
    setReceipts([]);
    setLoadErrors({ bookings: false, orders: false, receipts: false });
    setError('');
    setSuccess('');
  }, [user?.id]);

  useEffect(() => {
    let mounted = true;
    let requestId = 0;

    const fetchCustomerData = async () => {
      const currentRequestId = ++requestId;
      const results = await loadCustomerDashboard({
        bookings: async () => (await api.get<Booking[]>('/customer/bookings')).data,
        orders: async () => (await api.get<Order[]>('/customer/orders')).data,
        receipts: async () => (await api.get<ReceiptSummary[]>('/customer/receipts')).data,
      });

      if (!mounted || currentRequestId !== requestId) {
        return;
      }

      if (results.bookings.ok) setBookings(results.bookings.value);
      if (results.orders.ok) setOrders(results.orders.value);
      if (results.receipts.ok) setReceipts(results.receipts.value);
      setLoadErrors({
        bookings: !results.bookings.ok,
        orders: !results.orders.ok,
        receipts: !results.receipts.ok,
      });
    };

    fetchCustomerData();
    const refreshInterval = setInterval(fetchCustomerData, 10000);
    window.addEventListener('focus', fetchCustomerData);
    return () => {
      mounted = false;
      clearInterval(refreshInterval);
      window.removeEventListener('focus', fetchCustomerData);
    };
  }, [loadAttempt, user?.id]);

  async function cancelBooking(id: number) {
    try {
      await api.delete(`/customer/bookings/${id}`);
      setBookings((prev) => prev.map((b) => (b.id === id ? { ...b, status: 'CANCELLED' } : b)));
      setError('');
      setSuccess('Reservation cancelled successfully.');
    } catch {
      setError('Unable to cancel reservation.');
      setSuccess('');
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>My Account</h1>
        <p>Welcome back, {user?.name}</p>
      </div>

      {error && <div className="alert alert-error">⚠ {error}</div>}
      {success && <div className="alert alert-success">✓ {success}</div>}

      <div className="section-title">Reservations</div>
      {loadErrors.bookings ? (
        <div className="alert alert-error" role="alert">
          Unable to load reservations.{' '}
          <button type="button" className="btn btn-sm" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Retry
          </button>
        </div>
      ) : bookings.length === 0 ? (
        <div className="empty-state">
          <span>📅</span>
          No reservations yet.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Location</th>
              <th>Table</th>
              <th>Guests</th>
              <th>Date</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bookings.map((booking) => (
              <tr key={booking.id}>
                <td>{booking.table.branch.name}</td>
                <td>Table {booking.table.tableNumber}</td>
                <td>{booking.guestCount}</td>
                <td>{new Date(booking.date).toLocaleString()}</td>
                <td>
                  <span className={`badge badge-${booking.status.toLowerCase()}`}>{booking.status}</span>
                </td>
                <td>
                  {['PENDING', 'CONFIRMED'].includes(booking.status) && (
                    <button className="btn btn-danger btn-sm" type="button" onClick={() => cancelBooking(booking.id)}>
                      Cancel
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="section-title">Order History</div>
      {loadErrors.orders ? (
        <div className="alert alert-error" role="alert">
          Unable to load orders.{' '}
          <button type="button" className="btn btn-sm" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Retry
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className="empty-state">
          <span>🍷</span>
          No orders yet.
        </div>
      ) : (
        <div className="card-grid">
          {orders.map((order) => (
            <div className="card" key={order.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.6rem' }}>
                <div>
                  <span className="card-label">Order #{order.id}</span>
                  <p style={{ fontSize: '0.82rem', marginTop: '0.1rem', color: 'var(--text-secondary)' }}>
                    {order.branch.name} · {order.orderType.replace('_', ' ')} · {new Date(order.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', alignItems: 'flex-end' }}>
                  <span className={`badge badge-${(order.deliveryStatus === 'DELIVERED' ? 'done' : order.status).toLowerCase()}`}>
                    Kitchen: {order.deliveryStatus === 'DELIVERED' ? 'DONE' : order.status}
                  </span>
                  <span className={`badge ${order.paymentStatus === 'PAID' ? 'badge-success' : 'badge-warning'}`}>
                    {order.paymentStatus || 'UNPAID'}
                  </span>
                </div>
              </div>
              <ul style={{ margin: '0.5rem 0', paddingLeft: '1rem', color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.8 }}>
                {order.items.map((item, index) => (
                  <li key={index}>{item.menuItem.name} × {item.quantity}</li>
                ))}
              </ul>
              {order.orderType === 'DELIVERY' && (
                <div className="customer-delivery-progress">
                  <strong>Delivery: {order.deliveryStatus === 'ASSIGNED'
                    ? (order.status === 'DONE' || order.status === 'DELIVERED' ? 'Ready for pickup' : 'Driver assigned — awaiting preparation')
                    : order.deliveryStatus === 'OUT_FOR_DELIVERY' ? 'Out for delivery'
                      : order.deliveryStatus === 'DELIVERED' ? 'Delivered'
                        : 'Waiting for driver assignment'}</strong>
                  {order.recipientName && <div>Recipient: {order.recipientName} · {order.recipientPhone}</div>}
                  {order.deliveryAddress && <div>Address: {order.deliveryAddress}</div>}
                  {order.deliveryInstructions && <div>Instructions: {order.deliveryInstructions}</div>}
                  <div>Driver: {order.assignedDriver?.name ?? 'Not assigned yet'}</div>
                  {order.deliveredAt && <div>Delivered at: {new Date(order.deliveredAt).toLocaleString()}</div>}
                </div>
              )}
              <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="price">€{order.total.toFixed(2)}</span>
                {order.paymentStatus === 'PAID' && (
                  <Link className="btn btn-sm btn-primary" to={`/receipt/${order.id}`}>
                    View Receipt
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-title">My Receipts</div>
      {loadErrors.receipts ? (
        <div className="alert alert-error" role="alert">
          Unable to load receipts.{' '}
          <button type="button" className="btn btn-sm" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Retry
          </button>
        </div>
      ) : receipts.length === 0 ? (
        <div className="empty-state">
          <span>🧾</span>
          No receipts available yet.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Receipt #</th>
              <th>Order</th>
              <th>Branch</th>
              <th>Date</th>
              <th>Total</th>
              <th>Status</th>
              <th>Delivery</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {receipts.map((receipt) => (
              <tr key={receipt.orderId}>
                <td>{receipt.receiptNumber}</td>
                <td>#{receipt.orderId}</td>
                <td>{receipt.branchName ?? 'N/A'}</td>
                <td>{new Date(receipt.dateTime).toLocaleString()}</td>
                <td>€{receipt.totalAmount.toFixed(2)}</td>
                <td>
                  <span className={`badge ${receipt.paymentStatus === 'PAID' ? 'badge-success' : 'badge-warning'}`}>
                    {receipt.paymentStatus}
                  </span>
                </td>
                <td>{receipt.orderType === 'DELIVERY'
                  ? receipt.deliveryStatus === 'DELIVERED' ? `Delivered${receipt.deliveredAt ? ` · ${new Date(receipt.deliveredAt).toLocaleString()}` : ''}`
                    : receipt.deliveryStatus === 'OUT_FOR_DELIVERY' ? 'Out for delivery'
                      : receipt.deliveryStatus === 'ASSIGNED' ? 'Driver assigned'
                        : 'Waiting for driver'
                  : '—'}</td>
                <td>
                  <Link className="btn btn-sm btn-primary" to={`/receipt/${receipt.orderId}`}>
                    Open Receipt
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

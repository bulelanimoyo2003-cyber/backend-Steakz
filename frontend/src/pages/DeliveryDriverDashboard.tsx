import { useCallback, useEffect, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

interface DeliveryOrder {
  id: number;
  status: string;
  paymentStatus: 'UNPAID' | 'PAID';
  deliveryStatus: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  deliveryAddress: string | null;
  deliveryInstructions: string | null;
  assignedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  branch: { name: string; address: string };
  items: { quantity: number; menuItem: { name: string } }[];
}

interface DriverProfile {
  id: number;
  name: string;
  email: string;
  branch: { id: number; name: string; address: string };
}

export default function DeliveryDriverDashboard() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [orders, setOrders] = useState<DeliveryOrder[]>([]);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [success, setSuccess] = useState('');
  const [busyOrderId, setBusyOrderId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    try {
      const [profileResponse, ordersResponse] = await Promise.all([
        api.get<DriverProfile>('/driver/profile'),
        api.get<DeliveryOrder[]>('/driver/orders'),
      ]);
      setProfile(profileResponse.data);
      setOrders(ordersResponse.data);
      setLoadError('');
      setError('');
    } catch {
      setLoadError('Unable to load your driver profile and assigned deliveries.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
    const interval = setInterval(() => void loadOrders(), 10000);
    window.addEventListener('focus', loadOrders);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', loadOrders);
    };
  }, [loadOrders]);

  async function updateDelivery(orderId: number, action: 'pickup' | 'delivered') {
    if (busyOrderId !== null) return;
    setError('');
    setSuccess('');
    setBusyOrderId(orderId);
    try {
      await api.patch(`/driver/orders/${orderId}/${action}`);
      setSuccess(action === 'pickup' ? `Order #${orderId} is out for delivery.` : `Order #${orderId} marked delivered.`);
      await loadOrders();
    } catch (requestError: unknown) {
      const message = typeof requestError === 'object' && requestError !== null
        ? (requestError as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setError(message ?? 'Unable to update delivery status. Refresh and try again.');
    } finally {
      setBusyOrderId(null);
    }
  }

  const activeOrders = orders.filter((order) => order.deliveryStatus !== 'DELIVERED' && order.status !== 'DELIVERED');
  const historyOrders = orders.filter((order) => order.deliveryStatus === 'DELIVERED' || order.status === 'DELIVERED');

  function renderOrder(order: DeliveryOrder, history = false) {
    const isDelivered = order.deliveryStatus === 'DELIVERED' || order.status === 'DELIVERED';
    const kitchenReady = order.status === 'DONE' || isDelivered;
    const paymentConfirmed = order.paymentStatus === 'PAID';
    return (
      <article className="driver-delivery-card" key={order.id}>
        <div className="driver-delivery-heading">
          <div>
            <span className="card-label">Order #{order.id}</span>
            <div className="driver-branch">{order.branch.name} · {order.branch.address}</div>
          </div>
          <div className="driver-statuses">
            <span className={`badge badge-${(isDelivered ? 'done' : order.status).toLowerCase()}`}>
              Kitchen: {kitchenReady ? 'Ready for collection' : 'Waiting for kitchen'}
            </span>
            <span className={`badge ${paymentConfirmed ? 'badge-success' : 'badge-warning'}`}>
              {paymentConfirmed ? 'Paid' : 'Awaiting payment confirmation from cashier'}
            </span>
            <span className={`badge badge-${(order.deliveryStatus ?? 'unassigned').toLowerCase()}`}>
              {isDelivered ? 'Delivered'
                : order.deliveryStatus === 'ASSIGNED' ? 'Assigned'
                : order.deliveryStatus === 'OUT_FOR_DELIVERY' ? 'Out for delivery'
                  : 'Waiting for driver assignment'}
            </span>
          </div>
        </div>
        <div className="driver-recipient">
          <strong>{order.recipientName}</strong>
          <a href={`tel:${order.recipientPhone}`}>{order.recipientPhone}</a>
        </div>
        <div><strong>Delivery address</strong><p>{order.deliveryAddress}</p></div>
        {order.deliveryInstructions && <div><strong>Instructions</strong><p>{order.deliveryInstructions}</p></div>}
        <div><strong>Items</strong>
          <ul>{order.items.map((item, index) => <li key={`${order.id}-${index}`}>{item.menuItem.name} × {item.quantity}</li>)}</ul>
        </div>
        <div className="driver-delivery-timestamps">
          {order.assignedAt && <span>Assigned {new Date(order.assignedAt).toLocaleString()}</span>}
          {order.pickedUpAt && <span>Picked up {new Date(order.pickedUpAt).toLocaleString()}</span>}
          {order.deliveredAt && <span>Delivered {new Date(order.deliveredAt).toLocaleString()}</span>}
        </div>
        {!history && (
          <div className="driver-delivery-actions">
            {order.deliveryStatus === 'ASSIGNED' && (
              <button
                className="btn btn-primary"
                type="button"
                disabled={!kitchenReady || !paymentConfirmed || busyOrderId !== null}
                onClick={() => void updateDelivery(order.id, 'pickup')}
              >
                {busyOrderId === order.id ? 'Collecting…' : 'Collect / Start delivery'}
              </button>
            )}
            {order.deliveryStatus === 'ASSIGNED' && (!kitchenReady || !paymentConfirmed) && (
              <span className="driver-waiting">
                {!kitchenReady && !paymentConfirmed
                  ? 'Waiting for kitchen preparation and cashier payment confirmation.'
                  : !kitchenReady
                    ? 'Waiting for kitchen preparation before collection.'
                    : 'Awaiting payment confirmation from cashier before collection.'}
              </span>
            )}
            {order.deliveryStatus === 'OUT_FOR_DELIVERY' && (
              <button
                className="btn btn-primary"
                type="button"
                disabled={busyOrderId !== null}
                onClick={() => void updateDelivery(order.id, 'delivered')}
              >
                {busyOrderId === order.id ? 'Updating…' : 'Mark delivered'}
              </button>
            )}
            {order.deliveryStatus === 'ASSIGNED' && order.status !== 'DONE' && (
              <span className="driver-waiting">Waiting for kitchen — collection is available when preparation is DONE.</span>
            )}
          </div>
        )}
      </article>
    );
  }

  return (
    <main className="page driver-dashboard">
      <header className="page-header">
        <h1>Delivery Dashboard</h1>
        <p>Welcome, {profile?.name ?? user?.name}.</p>
        <p>
          Assigned restaurant branch: {profile
            ? `${profile.branch.name} · ${profile.branch.address}`
            : 'Loading branch assignment…'}
        </p>
      </header>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {loadError && (
        <div className="alert alert-error" role="alert">
          {loadError}{' '}
          <button type="button" className="btn btn-sm" onClick={() => void loadOrders()}>Retry</button>
        </div>
      )}
      {success && <div className="alert alert-success" role="status">{success}</div>}

      <h2 className="section-title">Active deliveries</h2>
      {loading ? (
        <div role="status">Loading assigned deliveries…</div>
      ) : loadError ? null : activeOrders.length === 0 ? (
        <div className="empty-state"><span>🚴</span>No active deliveries assigned.</div>
      ) : (
        <section className="driver-delivery-list">{activeOrders.map((order) => renderOrder(order))}</section>
      )}

      <h2 className="section-title">Delivery history</h2>
      {loading || loadError ? null : historyOrders.length === 0 ? (
        <div className="empty-state"><span>📦</span>No completed deliveries yet.</div>
      ) : (
        <section className="driver-delivery-list">{historyOrders.map((order) => renderOrder(order, true))}</section>
      )}
    </main>
  );
}

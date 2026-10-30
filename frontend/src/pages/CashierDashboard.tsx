import { useEffect, useState } from 'react';
import api from '../api/axios';

interface MenuItem {
  id: number;
  name: string;
  price: number;
}

interface SelectedItem {
  id: number;
  qty: number;
}

interface OrderItem {
  menuItem: { name: string };
  quantity: number;
  unitPrice: number;
}

interface Order {
  id: number;
  total: number;
  status: string;
  orderType: string;
  paymentStatus?: string;
  createdAt: string;
  items: OrderItem[];
}

export default function CashierDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [selected, setSelected] = useState<SelectedItem[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    api.get<Order[]>('/cashier/orders')
      .then((response) => setOrders(response.data))
      .catch((e) => {
        console.error('[Cashier] orders load error', e);
        const message = (e as any)?.response?.data?.error ?? 'Unable to load orders.';
        setError(message);
      });

    api.get<MenuItem[]>('/cashier/menu')
      .then((response) => setMenu(response.data))
      .catch((e) => {
        console.error('[Cashier] menu load error', e);
        const message = (e as any)?.response?.data?.error ?? 'Unable to load menu.';
        setError(message);
      });
  }, []);

  function toggleItem(id: number) {
    setSelected((prev) => {
      const existing = prev.find((item) => item.id === id);
      if (existing) {
        return prev.filter((item) => item.id !== id);
      }
      return [...prev, { id, qty: 1 }];
    });
  }

  function setQty(id: number, qty: number) {
    setSelected((prev) => prev.map((item) => (item.id === id ? { ...item, qty: Math.max(1, qty) } : item)));
  }

  async function submitOrder() {
    setError('');
    setNotice(null);
    if (selected.length === 0) {
      setError('Add at least one item.');
      return;
    }

    try {
      await api.post('/cashier/orders', {
        items: selected.map((item) => ({ menuItemId: item.id, quantity: item.qty })),
      });
      const response = await api.get<Order[]>('/cashier/orders');
      setOrders(response.data);
      setSelected([]);
      setNotice({ type: 'success', message: 'Order created successfully.' });
    } catch (err: unknown) {
      console.error('[Cashier] create order error', err);
      const message =
        typeof err === 'object' && err !== null && 'response' in err && (err as any).response?.data?.error
          ? (err as any).response.data.error
          : 'Failed to create order.';
      setError(message);
    }
  }

  async function markDelivered(id: number) {
    try {
      await api.patch(`/cashier/orders/${id}/deliver`);
      const response = await api.get<Order[]>('/cashier/orders');
      setOrders(response.data);
      setNotice({ type: 'success', message: 'Order marked delivered.' });
    } catch (err: unknown) {
      console.error('[Cashier] mark delivered error', err);
      const message =
        typeof err === 'object' && err !== null && 'response' in err && (err as any).response?.data?.error
          ? (err as any).response.data.error
          : 'Unable to update delivery status.';
      setError(message);
    }
  }

  async function markPaid(id: number) {
    try {
      await api.patch(`/cashier/orders/${id}/pay`);
      const response = await api.get<Order[]>('/cashier/orders');
      setOrders(response.data);
      setNotice({ type: 'success', message: 'Payment recorded.' });
    } catch (err: unknown) {
      console.error('[Cashier] mark paid error', err);
      const message =
        typeof err === 'object' && err !== null && 'response' in err && (err as any).response?.data?.error
          ? (err as any).response.data.error
          : 'Unable to update payment status.';
      setError(message);
    }
  }

  const orderTotal = selected.reduce((sum, item) => {
    const menuItem = menu.find((m) => m.id === item.id);
    return sum + (menuItem?.price ?? 0) * item.qty;
  }, 0);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Point of Sale</h1>
        <p>Create orders and manage delivery status</p>
      </div>

      {error && <div className="alert alert-error">⚠ {error}</div>}
      {notice && <div className={`alert ${notice.type === 'success' ? 'alert-success' : 'alert-error'}`}>{notice.message}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        <div className="card">
          <h2 style={{ marginBottom: '1.25rem' }}>New Order</h2>
          <div style={{ maxHeight: 340, overflowY: 'auto', marginBottom: '1rem' }}>
            {menu.map((item) => {
              const selectedItem = selected.find((selectedRow) => selectedRow.id === item.id);
              return (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem',
                    padding: '0.55rem 0',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(selectedItem)}
                    onChange={() => toggleItem(item.id)}
                    style={{ width: 'auto', accentColor: 'var(--cognac)' }}
                  />
                  <span style={{ flex: 1, fontSize: '0.9rem' }}>{item.name}</span>
                  <span className="price" style={{ fontSize: '0.9rem' }}>€{item.price.toFixed(2)}</span>
                  {selectedItem && (
                    <input
                      type="number"
                      min="1"
                      value={selectedItem.qty}
                      onChange={(event) => setQty(item.id, Number(event.target.value))}
                      style={{ width: 56, padding: '0.3rem 0.5rem', fontSize: '0.85rem' }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {selected.length > 0 && (
            <div className="sticky-summary" style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Order Total
                </span>
                <span className="price">€{orderTotal.toFixed(2)}</span>
              </div>
              <button className="btn btn-primary" type="button" style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }} onClick={submitOrder}>
                Place Order
              </button>
            </div>
          )}

          {!selected.length && (
            <button className="btn btn-primary" type="button" style={{ width: '100%', justifyContent: 'center' }} onClick={submitOrder}>
              Place Order
            </button>
          )}
        </div>

        <div>
          <h2 style={{ marginBottom: '1.25rem' }}>Recent Orders</h2>
          {orders.slice(0, 10).map((order) => (
            <div className="card" key={order.id} style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="card-label">Order #{order.id}</span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <span className={`badge badge-${order.status.toLowerCase()}`}>{order.status}</span>
                  <span className={`badge ${order.paymentStatus === 'PAID' ? 'badge-success' : 'badge-warning'}`}>
                    {order.paymentStatus || 'UNPAID'}
                  </span>
                </div>
              </div>
              <span className="driver-branch">{order.orderType.replace('_', ' ')}</span>
              <span className="price" style={{ display: 'block', marginTop: '0.3rem' }}>€{order.total.toFixed(2)}</span>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                {order.paymentStatus !== 'PAID' && (
                  <button className="btn btn-outline btn-sm" type="button" onClick={() => markPaid(order.id)}>
                    Mark Paid
                  </button>
                )}
                {order.status === 'DONE' && order.orderType !== 'DELIVERY' && (
                  <button className="btn btn-outline btn-sm" type="button" onClick={() => markDelivered(order.id)}>
                    Mark Delivered
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import api from '../api/axios';
import KpiCard from '../components/KpiCard';

interface OrderItem {
  menuItem: { name: string };
  quantity: number;
}

interface Order {
  id: number;
  status: string;
  paymentStatus?: string;
  createdAt: string;
  items: OrderItem[];
}

interface MenuItem {
  id: number;
  name: string;
  category: string;
  price: number;
}

export default function ChefDashboard() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [error, setError] = useState('');

  async function loadOrders() {
    try {
      const response = await api.get<Order[]>('/chef/orders');
      setOrders(response.data);
    } catch {
      setError('Unable to load orders.');
    }
  }

  useEffect(() => {
    loadOrders();
    api.get<MenuItem[]>('/chef/menu')
      .then((response) => setMenu(response.data))
      .catch(() => setError('Unable to load menu items.'));
  }, []);

  async function markDone(id: number) {
    try {
      await api.patch(`/chef/orders/${id}/done`);
      await loadOrders();
    } catch {
      setError('Unable to update order status.');
    }
  }

  async function markPreparing(id: number) {
    try {
      await api.patch(`/chef/orders/${id}/preparing`);
      await loadOrders();
    } catch {
      setError('Unable to start preparing order.');
    }
  }

  async function deleteMenuItem(id: number) {
    if (!window.confirm('Remove this item from the menu?')) return;
    try {
      await api.delete(`/chef/menu/${id}`);
      setMenu((prev) => prev.filter((item) => item.id !== id));
    } catch {
      setError('Unable to delete menu item.');
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Kitchen</h1>
        <p>Active orders and branch menu management</p>
      </div>

      {error && <div className="alert alert-error">⚠ {error}</div>}

      <div className="kpi-grid">
        <KpiCard
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 13h4v8H3zM10 7h4v14h-4zM17 3h4v18h-4z" fill="currentColor"/></svg>}
          label="Active Orders"
          value={orders.length}
          bg="linear-gradient(135deg,#1E293B,#3B82F6)"
        />
        <KpiCard
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h16v2H4zM4 11h10v2H4zM4 16h7v2H4z" fill="currentColor"/></svg>}
          label="Menu Items"
          value={menu.length}
          bg="linear-gradient(135deg,#E67E22,#F59E0B)"
        />
      </div>

      <div className="section-title">Active Orders</div>
      {orders.length === 0 ? (
        <div className="empty-state">
          <span>✓</span>
          All caught up — no active orders.
        </div>
      ) : (
        <div className="card-grid">
          {orders.map((order) => (
            <div className="order-card" key={order.id}>
              <div className="order-meta">
                <span className="card-label">Order #{order.id}</span>
                <span className={`order-status ${order.status.toLowerCase()}`}>{order.status}</span>
              </div>
              <div className="order-items">
                <ul style={{ paddingLeft: '1rem', margin: 0 }}>
                  {order.items.map((item, index) => (
                    <li key={index}>{item.menuItem.name} × {item.quantity}</li>
                  ))}
                </ul>
              </div>
              <div className="order-progress">
                <div className={`order-progress-fill ${order.status.toLowerCase()}`} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem', flexWrap: 'wrap' }}>
                {order.status === 'PENDING' && (
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => markPreparing(order.id)}>
                    Start Preparing
                  </button>
                )}
                {order.status === 'PREPARING' && (
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => markDone(order.id)}>
                    ✓ Mark Complete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="section-title">Branch Menu</div>
      <table className="data-table">
        <thead>
          <tr><th>Item</th><th>Category</th><th>Price</th><th /></tr>
        </thead>
        <tbody>
          {menu.map((item) => (
            <tr key={item.id}>
              <td>{item.name}</td>
              <td style={{ color: 'var(--text-muted)' }}>{item.category}</td>
              <td><span className="price" style={{ fontSize: '0.95rem' }}>€{item.price.toFixed(2)}</span></td>
              <td>
                <button className="btn btn-danger btn-sm" type="button" onClick={() => deleteMenuItem(item.id)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { useEffect, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

interface Branch {
  id: number;
  name: string;
  address: string;
}

interface MenuItem {
  id: number;
  name: string;
  description?: string;
  price: number;
  category: string;
}

export default function MenuPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<{ item: MenuItem; quantity: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get<Branch[]>('/public/branches')
      .then((response) => setBranches(response.data))
      .catch(() => setError('Unable to load branches.'));
  }, []);

  async function loadMenu(branchId: number) {
    setSelectedId(branchId);
    setLoading(true);
    setError('');
    try {
      const response = await api.get<MenuItem[]>(`/menu/${branchId}`);
      setMenu(response.data);
    } catch {
      setMenu([]);
      setError('Unable to load menu for this location.');
    } finally {
      setLoading(false);
    }
  }

  function handleAddToCart(menuItem: MenuItem) {
    setCart((c) => {
      const found = c.find((x) => x.item.id === menuItem.id);
      if (found) {
        return c.map((x) => (x.item.id === menuItem.id ? { ...x, quantity: x.quantity + 1 } : x));
      }
      return [...c, { item: menuItem, quantity: 1 }];
    });
    setNotice({ type: 'success', text: `${menuItem.name} added to cart.` });
    setTimeout(() => setNotice(null), 2500);
  }

  function increaseQuantity(id: number) {
    setCart((c) => c.map((x) => (x.item.id === id ? { ...x, quantity: x.quantity + 1 } : x)));
  }

  function decreaseQuantity(id: number) {
    setCart((c) => {
      const found = c.find((x) => x.item.id === id);
      if (!found) return c;
      if (found.quantity <= 1) return c.filter((x) => x.item.id !== id);
      return c.map((x) => (x.item.id === id ? { ...x, quantity: x.quantity - 1 } : x));
    });
  }

  const total = cart.reduce((s, it) => s + it.item.price * it.quantity, 0);

  async function handleCheckout() {
    setNotice(null);
    if (!user) {
      setNotice({ type: 'error', text: 'Please sign in to place an order.' });
      return;
    }

    if (user.role !== 'CUSTOMER') {
      setNotice({ type: 'error', text: 'Only customers can place orders.' });
      return;
    }

    try {
      const bookingsResp = await api.get('/customer/bookings');
      const bookings = bookingsResp.data as any[];
      if (!bookings || bookings.length === 0) {
        setNotice({ type: 'info', text: 'You have no bookings. Please create a booking before ordering.' });
        return;
      }

      const bookingId = bookings[0].id;
      const items = cart.map((c) => ({ menuItemId: c.item.id, quantity: c.quantity }));

      const resp = await api.post('/customer/orders', { bookingId, items });
      const order = resp.data as any;
      setCart([]);
      setNotice({ type: 'success', text: 'Order created successfully. Please pay at the cashier to receive your receipt.' });
      return order;
    } catch (e: any) {
      console.error('[Checkout] Error', e);
      const text = e?.response?.data?.error ?? 'Failed to create order.';
      setNotice({ type: 'error', text });
    }
  }

  const categories = [...new Set(menu.map((item) => item.category))];

  return (
    <div className="page">
      <div className="page-header">
        <h1>Our Menu</h1>
        <p>Select a location to view available cuts and dishes</p>
      </div>

      <aside style={{ position: 'relative' }}>
        <div className="cart-panel" aria-live="polite">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong>Cart</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{cart.length} items</span>
          </div>

          {notice && <div className={`alert ${notice.type === 'error' ? 'alert-error' : notice.type === 'success' ? 'alert-success' : ''}`}>{notice.text}</div>}

          <div className="cart-items">
            {cart.length === 0 && <div style={{ color: 'var(--text-muted)' }}>Your cart is empty. Tap an item to add it.</div>}
            {cart.map((c) => (
              <div className="cart-row" key={c.item.id}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{c.item.name}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>€{c.item.price.toFixed(2)}</div>
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <button className="btn btn-sm" onClick={() => decreaseQuantity(c.item.id)}>-</button>
                  <div style={{ minWidth: '22px', textAlign: 'center' }}>{c.quantity}</div>
                  <button className="btn btn-sm" onClick={() => increaseQuantity(c.item.id)}>+</button>
                </div>
              </div>
            ))}
          </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem' }}>
            <div style={{ fontWeight: 700 }}>Total</div>
            <div style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.05rem', color: 'var(--cognac-light)' }}>€{total.toFixed(2)}</div>
          </div>

          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-primary" type="button" onClick={handleCheckout} disabled={cart.length === 0}>
              Checkout
            </button>
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                setCart([]);
                setNotice(null);
              }}
            >
              Clear
            </button>
          </div>
        </div>
      </aside>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '2.5rem' }}>
        {branches.map((branch) => (
          <button
            key={branch.id}
            type="button"
            className={`btn ${selectedId === branch.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => loadMenu(branch.id)}
          >
            {branch.name.replace('Steakz ', '')}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ color: 'var(--text-muted)', padding: '2rem 0', textAlign: 'center' }}>
          Loading menu…
        </div>
      )}

      {error && <div className="alert alert-error">⚠ {error}</div>}

      {selectedId && !loading && menu.length === 0 && !error && (
        <div className="empty-state">
          <span>🍽</span>
          No menu items available for this location yet.
        </div>
      )}

      {!selectedId && (
        <div className="empty-state">
          <span>✦</span>
          Choose a location above to view its menu.
        </div>
      )}

      {categories.map((category) => (
        <div key={category} style={{ marginBottom: '2.5rem' }}>
          <div className="section-title">{category}</div>
          <div className="card-grid">
            {menu
              .filter((item) => item.category === category)
              .map((item) => (
                <div className="card clickable" key={item.id} onClick={() => handleAddToCart(item)}>
                  <span className="card-label">{category}</span>
                  <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)', fontFamily: 'Playfair Display, serif' }}>
                    {item.name}
                  </h3>
                  {item.description && (
                    <p style={{ fontSize: '0.87rem', marginBottom: '1rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>
                      {item.description}
                    </p>
                  )}
                  <div style={{ marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="price">€{item.price.toFixed(2)}</span>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      style={{ marginLeft: '1rem' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleAddToCart(item);
                      }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

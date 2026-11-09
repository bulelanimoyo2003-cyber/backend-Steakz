import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AxiosError } from 'axios';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

interface Branch {
  id: number;
  name: string;
  address: string;
  deliveryAvailable: boolean;
}

interface MenuItem {
  id: number;
  branchId: number;
  name: string;
  description?: string;
  price: number;
  category: string;
}

interface EligibleBooking {
  id: number;
  date: string;
  guestCount: number;
  table: { tableNumber: number; branch: { name: string } };
}

interface PaymentMethodOption {
  id: 'CASH' | 'STRIPE';
  label: string;
}

interface CheckoutQuote {
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  total: number;
  currency: string;
  pricingNote: string;
  fingerprint: string;
}

async function hashCheckoutFingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default function MenuPage() {
  const { user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [cart, setCart] = useState<{ item: MenuItem; quantity: number; branchId: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkoutInProgress, setCheckoutInProgress] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [orderType, setOrderType] = useState<'DINE_IN' | 'COLLECTION' | 'DELIVERY'>('DINE_IN');
  const [eligibleBookings, setEligibleBookings] = useState<EligibleBooking[]>([]);
  const [selectedBookingId, setSelectedBookingId] = useState('');
  const [bookingLoadError, setBookingLoadError] = useState(false);
  const [bookingLoadAttempt, setBookingLoadAttempt] = useState(0);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([
    { id: 'CASH', label: 'Cash at the cashier' },
  ]);
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'STRIPE'>('CASH');
  const [checkoutQuote, setCheckoutQuote] = useState<CheckoutQuote | null>(null);
  const [quoteError, setQuoteError] = useState('');
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  const [recipientName, setRecipientName] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryInstructions, setDeliveryInstructions] = useState('');
  const checkoutInProgressRef = useRef(false);
  const checkoutRequestRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const menuRequest = useRef({ id: 0, branchId: 0 });
  const navigate = useNavigate();
  const quoteFingerprint = JSON.stringify({
    branchId: selectedId,
    orderType,
    items: cart.map((entry) => ({ menuItemId: entry.item.id, quantity: entry.quantity })),
  });

  useEffect(() => {
    let active = true;
    if (user?.role !== 'CUSTOMER') return () => { active = false; };
    api.get<{ methods: PaymentMethodOption[] }>('/customer/payment-methods')
      .then(({ data }) => {
        if (!active) return;
        setPaymentMethods(data.methods);
        if (!data.methods.some((method) => method.id === paymentMethod)) setPaymentMethod('CASH');
      })
      .catch(() => {
        if (active) setNotice({ type: 'error', text: 'Unable to load payment options. Please refresh before checking out.' });
      });
    return () => { active = false; };
  }, [user?.id, user?.role]);

  useEffect(() => {
    let active = true;
    if (!selectedId || cart.length === 0 || user?.role !== 'CUSTOMER') {
      setCheckoutQuote(null);
      setQuoteError('');
      return () => { active = false; };
    }
    setCheckoutQuote(null);
    setQuoteError('');
    api.post('/customer/orders/quote', {
      branchId: selectedId,
      orderType,
      items: cart.map((entry) => ({ menuItemId: entry.item.id, quantity: entry.quantity })),
    }).then(({ data }) => {
      if (active) setCheckoutQuote({ ...data, fingerprint: quoteFingerprint });
    }).catch((quoteRequestError: unknown) => {
      if (!active) return;
      const message = typeof quoteRequestError === 'object' && quoteRequestError !== null
        ? (quoteRequestError as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setQuoteError(message ?? 'Unable to calculate the current total. Please try again.');
    });
    return () => { active = false; };
  }, [quoteFingerprint, selectedId, orderType, user?.id, user?.role, quoteAttempt]);

  useEffect(() => {
    if (user?.name) setRecipientName((current) => current || user.name);
  }, [user?.name]);

  useEffect(() => {
    api
      .get<Branch[]>('/public/branches')
      .then((response) => setBranches(response.data))
      .catch(() => setError('Unable to load branches.'));
  }, []);

  useEffect(() => {
    let active = true;
    setEligibleBookings([]);
    setSelectedBookingId('');
    setBookingLoadError(false);

    if (orderType !== 'DINE_IN' || !selectedId || user?.role !== 'CUSTOMER') {
      setLoadingBookings(false);
      return () => { active = false; };
    }

    setLoadingBookings(true);
    api.get<EligibleBooking[]>('/customer/bookings/eligible', { params: { branchId: selectedId } })
      .then((response) => {
        if (active) setEligibleBookings(response.data);
      })
      .catch(() => {
        if (active) setBookingLoadError(true);
      })
      .finally(() => {
        if (active) setLoadingBookings(false);
      });

    return () => { active = false; };
  }, [orderType, selectedId, user?.id, user?.role, bookingLoadAttempt]);

  async function loadMenu(branchId: number) {
    const cartBranchId = cart[0]?.branchId;
    const changedBranch = (selectedId !== null && selectedId !== branchId)
      || (cartBranchId !== undefined && cartBranchId !== branchId);
    if (checkoutInProgressRef.current) {
      setNotice({ type: 'info', text: 'Wait for checkout to finish before changing locations.' });
      return;
    }
    if (changedBranch && cart.length > 0) {
      const currentBranch = branches.find((branch) => branch.id === cart[0].branchId);
      const nextBranch = branches.find((branch) => branch.id === branchId);
      const confirmed = window.confirm(
        `Your cart contains items from ${currentBranch?.name ?? 'another location'}. Clear the cart and switch to ${nextBranch?.name ?? 'this location'}?`,
      );
      if (!confirmed) return;
    }

    const requestId = menuRequest.current.id + 1;
    menuRequest.current = { id: requestId, branchId };
    const isCurrentRequest = () => menuRequest.current.id === requestId
      && menuRequest.current.branchId === branchId;
    setEligibleBookings([]);
    setSelectedBookingId('');
    setSelectedId(branchId);
    setMenu([]);
    setLoading(true);
    setError('');
    if (changedBranch && cart.length > 0) {
      setCart([]);
      checkoutRequestRef.current = null;
      setNotice({ type: 'info', text: 'Cart cleared after you confirmed switching locations.' });
    }
    try {
      const response = await api.get<MenuItem[]>(`/menu/${branchId}`);
      if (!isCurrentRequest()) return;
      setMenu(response.data);
    } catch (error: unknown) {
      if (!isCurrentRequest()) return;
      setMenu([]);
      if ((error as AxiosError)?.response?.status === 404) {
        try {
          const response = await api.get<Branch[]>('/public/branches');
          if (!isCurrentRequest()) return;
          setBranches(response.data);
          setError('This location is no longer active. Please select an active location.');
        } catch {
          setError('This location may no longer be active. Refresh the page and select an active location.');
        }
      } else {
        setError('Unable to load menu for this location.');
      }
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }

  function handleAddToCart(menuItem: MenuItem) {
    if (!selectedId || menuItem.branchId !== selectedId) {
      setNotice({ type: 'error', text: 'This item belongs to a different location. Select its location before adding it.' });
      return;
    }
    setCart((c) => {
      const found = c.find((x) => x.item.id === menuItem.id);
      if (found) {
        return c.map((x) => (x.item.id === menuItem.id ? { ...x, quantity: x.quantity + 1 } : x));
      }
      return [...c, { item: menuItem, quantity: 1, branchId: selectedId }];
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
  const currentQuote = checkoutQuote?.fingerprint === quoteFingerprint ? checkoutQuote : null;

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
    if (!selectedId) {
      setNotice({ type: 'error', text: 'Choose a location before checking out.' });
      return;
    }
    if (cart.some((entry) => entry.branchId !== selectedId || entry.item.branchId !== selectedId)) {
      setNotice({ type: 'error', text: 'Your cart contains items from another location. Clear it or confirm a location switch before checking out.' });
      return;
    }
    if (!currentQuote) {
      setNotice({ type: 'info', text: quoteError || 'Calculating the current menu total. Please wait a moment.' });
      return;
    }

    let activeBranches: Branch[];
    try {
      const response = await api.get<Branch[]>('/public/branches');
      activeBranches = response.data;
      setBranches(activeBranches);
    } catch {
      setNotice({ type: 'error', text: 'Unable to confirm this location is active. Please try again.' });
      return;
    }
    if (!activeBranches.some((branch) => branch.id === selectedId)) {
      setSelectedId(null);
      setMenu([]);
      checkoutRequestRef.current = null;
      setNotice({
        type: 'error',
        text: 'Your selected location is no longer active. Your cart is preserved; clear it or confirm a switch to an active location.',
      });
      return;
    }

    const selectedBranch = activeBranches.find((branch) => branch.id === selectedId);
    if (orderType === 'DELIVERY' && !selectedBranch?.deliveryAvailable) {
      setNotice({
        type: 'error',
        text: `Delivery is currently unavailable at ${selectedBranch?.name ?? 'this location'}. Choose another active location or select collection.`,
      });
      return;
    }

    if (orderType === 'DELIVERY'
      && (!recipientName.trim()
        || !/^\+?[0-9\s().-]{7,30}$/.test(recipientPhone.trim())
        || !deliveryAddress.trim()
        || recipientName.trim().length > 120
        || deliveryAddress.trim().length > 500
        || deliveryInstructions.trim().length > 500)) {
      setNotice({ type: 'error', text: 'Enter a recipient name, valid phone number, and delivery address. Instructions may be up to 500 characters.' });
      return;
    }

    if (checkoutInProgressRef.current) {
      return;
    }
    checkoutInProgressRef.current = true;
    setCheckoutInProgress(true);

    try {
      const items = cart.map((c) => ({ menuItemId: c.item.id, quantity: c.quantity }));
      let payload: Record<string, unknown> = { orderType, branchId: selectedId, items, paymentMethod };
      if (orderType === 'DINE_IN') {
        const booking = eligibleBookings.find((candidate) => candidate.id === Number(selectedBookingId));
        if (!booking) {
          setNotice({ type: 'error', text: 'A confirmed booking is required to dine in. Please reserve a table first.' });
          return;
        }
        payload = { orderType, branchId: selectedId, bookingId: booking.id, items, paymentMethod };
      } else if (orderType === 'DELIVERY') {
        payload = {
          ...payload,
          recipientName: recipientName.trim(),
          recipientPhone: recipientPhone.trim(),
          deliveryAddress: deliveryAddress.trim(),
          deliveryInstructions: deliveryInstructions.trim(),
        };
      }

      const fingerprint = await hashCheckoutFingerprint(JSON.stringify({ customerId: user.id, ...payload }));
      if (checkoutRequestRef.current?.fingerprint !== fingerprint) {
        let saved: { fingerprint?: string; key?: string } | null = null;
        try {
          saved = JSON.parse(sessionStorage.getItem('steakz-checkout-idempotency') ?? 'null');
        } catch {
          saved = null;
        }
        checkoutRequestRef.current = {
          fingerprint,
          key: saved?.fingerprint === fingerprint && typeof saved.key === 'string'
            ? saved.key
            : crypto.randomUUID(),
        };
      }
      sessionStorage.setItem('steakz-checkout-idempotency', JSON.stringify(checkoutRequestRef.current));

      const resp = await api.post('/customer/orders', payload, {
        headers: { 'Idempotency-Key': checkoutRequestRef.current.key },
      });
      const order = resp.data as any;
      setCart([]);
      checkoutRequestRef.current = null;
      sessionStorage.removeItem('steakz-checkout-idempotency');
      navigate(`/orders/${order.id}`);
      return order;
    } catch (e: any) {
      console.error('[Checkout] Error', e);
      if (orderType === 'DINE_IN' && e?.response?.status === 409) {
        setSelectedBookingId('');
        setBookingLoadError(false);
        setLoadingBookings(true);
        try {
          const response = await api.get<EligibleBooking[]>('/customer/bookings/eligible', {
            params: { branchId: selectedId },
          });
          setEligibleBookings(response.data);
          setNotice({
            type: 'error',
            text: response.data.length === 0
              ? 'A confirmed booking is required to dine in. Please reserve a table first.'
              : 'That booking is no longer eligible. Select another confirmed booking.',
          });
        } catch {
          setEligibleBookings([]);
          setBookingLoadError(true);
          setNotice({ type: 'error', text: 'Unable to refresh your eligible bookings. Please try again.' });
        } finally {
          setLoadingBookings(false);
        }
        return;
      }
      const text = e?.response?.data?.error ?? 'Failed to create order.';
      setNotice({ type: 'error', text });
    } finally {
      checkoutInProgressRef.current = false;
      setCheckoutInProgress(false);
    }
  }

  const categories = [...new Set(menu.map((item) => item.category))];

  return (
    <div className="page">
      <div className="page-header">
        <h1>Our Menu</h1>
        <p>Select an active location to view available cuts and dishes</p>
      </div>

      <aside style={{ position: 'relative' }}>
        <div className="cart-panel" aria-live="polite">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong>Cart{cart.length > 0 ? ` · ${branches.find((branch) => branch.id === cart[0].branchId)?.name ?? 'previous location'}` : ''}</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{cart.length} items</span>
          </div>

          <div className="form-group">
            <label htmlFor="order-type">Order type</label>
            <select id="order-type" value={orderType} onChange={(event) => {
              checkoutRequestRef.current = null;
              setEligibleBookings([]);
              setSelectedBookingId('');
              setOrderType(event.target.value as typeof orderType);
            }}>
              <option value="DINE_IN">Dine-in (booking required)</option>
              <option value="COLLECTION">Collection</option>
              <option value="DELIVERY">Delivery</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="payment-method">Payment method</label>
            <select id="payment-method" value={paymentMethod} onChange={(event) => {
              checkoutRequestRef.current = null;
              setPaymentMethod(event.target.value as 'CASH' | 'STRIPE');
            }}>
              {paymentMethods.map((method) => (
                <option key={method.id} value={method.id}>{method.label}</option>
              ))}
            </select>
            {paymentMethod === 'STRIPE' && (
              <small>Test payment: card details are entered only on Stripe’s hosted checkout page.</small>
            )}
          </div>

          {orderType === 'DINE_IN' && user?.role === 'CUSTOMER' && selectedId !== null && (
            <div className="form-group">
              <label htmlFor="dine-in-booking">Confirmed booking for this visit</label>
              {loadingBookings ? (
                <p role="status">Loading eligible bookings…</p>
              ) : bookingLoadError ? (
                <div className="alert alert-error" role="alert">
                  Unable to load your eligible bookings.{' '}
                  <button type="button" className="btn btn-sm" onClick={() => setBookingLoadAttempt((attempt) => attempt + 1)}>
                    Retry
                  </button>
                </div>
              ) : eligibleBookings.length === 0 ? (
                <div className="alert alert-error" role="alert">
                  <p>A confirmed booking is required to dine in. Please reserve a table first.</p>
                  <Link className="btn btn-primary" to="/book">Reserve a table</Link>
                </div>
              ) : (
                <select
                  id="dine-in-booking"
                  value={selectedBookingId}
                  onChange={(event) => {
                    checkoutRequestRef.current = null;
                    setSelectedBookingId(event.target.value);
                  }}
                  required
                >
                  <option value="">Select a confirmed booking</option>
                  {eligibleBookings.map((booking) => (
                    <option key={booking.id} value={booking.id}>
                      {new Date(booking.date).toLocaleString()} · Table {booking.table.tableNumber} · {booking.guestCount} guests
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {orderType === 'DELIVERY' && (
            <div className="delivery-details">
              {selectedId && !branches.find((branch) => branch.id === selectedId)?.deliveryAvailable && (
                <div className="alert alert-error" role="alert">
                  Delivery is unavailable at this location because no designated driver is available.
                </div>
              )}
              <div className="form-group">
                <label htmlFor="recipient-name">Recipient name</label>
                <input id="recipient-name" value={recipientName} maxLength={120} onChange={(event) => {
                  checkoutRequestRef.current = null;
                  setRecipientName(event.target.value);
                }} required />
              </div>
              <div className="form-group">
                <label htmlFor="recipient-phone">Phone number</label>
                <input id="recipient-phone" type="tel" value={recipientPhone} maxLength={30} onChange={(event) => {
                  checkoutRequestRef.current = null;
                  setRecipientPhone(event.target.value);
                }} autoComplete="tel" required />
              </div>
              <div className="form-group">
                <label htmlFor="delivery-address">Delivery address</label>
                <textarea id="delivery-address" value={deliveryAddress} maxLength={500} rows={3} onChange={(event) => {
                  checkoutRequestRef.current = null;
                  setDeliveryAddress(event.target.value);
                }} autoComplete="street-address" required />
              </div>
              <div className="form-group">
                <label htmlFor="delivery-instructions">Delivery instructions (optional)</label>
                <textarea id="delivery-instructions" value={deliveryInstructions} maxLength={500} rows={2} onChange={(event) => {
                  checkoutRequestRef.current = null;
                  setDeliveryInstructions(event.target.value);
                }} />
              </div>
            </div>
          )}

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

          <div style={{ marginTop: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Subtotal</span>
              <span>{currentQuote ? `€${currentQuote.subtotal.toFixed(2)}` : `€${total.toFixed(2)}`}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Discount</span><span>−€{(currentQuote?.discountTotal ?? 0).toFixed(2)}</span>
            </div>
            {orderType === 'DELIVERY' && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Delivery charge</span><span>€{(currentQuote?.deliveryFee ?? 0).toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: '0.35rem' }}>
              <span>Total</span>
              <span style={{ fontFamily: 'Playfair Display, serif', color: 'var(--cognac-light)' }}>
                {currentQuote ? `€${currentQuote.total.toFixed(2)}` : 'Calculating…'}
              </span>
            </div>
            {quoteError && (
              <div className="alert alert-error" role="alert">
                {quoteError}{' '}
                <button type="button" className="btn btn-sm" onClick={() => setQuoteAttempt((attempt) => attempt + 1)}>
                  Retry total
                </button>
              </div>
            )}
            {currentQuote && <small>{currentQuote.pricingNote}</small>}
          </div>

          <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-primary"
              type="button"
              onClick={handleCheckout}
              disabled={cart.length === 0 || checkoutInProgress
                || !currentQuote
                || (orderType === 'DINE_IN'
                  && (loadingBookings || bookingLoadError || !selectedBookingId
                    || !eligibleBookings.some((booking) => booking.id === Number(selectedBookingId))))
                || (orderType === 'DELIVERY'
                  && selectedId !== null
                  && !branches.find((branch) => branch.id === selectedId)?.deliveryAvailable)}
            >
              {checkoutInProgress ? 'Placing order…' : 'Checkout'}
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
            disabled={checkoutInProgress}
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

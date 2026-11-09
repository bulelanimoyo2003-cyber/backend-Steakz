import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/axios';

interface CustomerOrder {
  id: number;
  status: string;
  orderType: string;
  deliveryStatus: string | null;
  paymentStatus: string;
  paymentMethod: 'CASH' | 'STRIPE' | null;
  total: number;
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  currency: string;
  createdAt: string;
  branch: { name: string };
  items: { quantity: number; unitPrice: number; menuItem: { name: string } }[];
}

interface PaymentMethod {
  id: 'CASH' | 'STRIPE';
  label: string;
}

function paymentLabel(order: CustomerOrder) {
  if (order.paymentStatus === 'PAID') return 'Payment successful';
  if (order.paymentStatus === 'FAILED') return 'Payment failed';
  if (order.paymentStatus === 'CANCELLED') return 'Payment cancelled';
  return order.paymentMethod === 'STRIPE' ? 'Payment pending' : 'Awaiting cashier payment confirmation';
}

export default function CustomerOrderPage() {
  const { orderId } = useParams();
  const id = Number(orderId);
  const [order, setOrder] = useState<CustomerOrder | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [showCashInstructions, setShowCashInstructions] = useState(false);

  const refresh = useCallback(async () => {
    if (!Number.isSafeInteger(id) || id <= 0) {
      setError('Invalid order reference.');
      setLoading(false);
      return;
    }
    try {
      const [orderResult, methodsResult] = await Promise.allSettled([
        api.get<CustomerOrder>(`/customer/orders/${id}`, { headers: { 'Cache-Control': 'no-cache' } }),
        api.get<{ methods: PaymentMethod[] }>('/customer/payment-methods'),
      ]);
      if (orderResult.status === 'rejected') throw orderResult.reason;
      setOrder(orderResult.value.data);
      if (orderResult.value.data.paymentStatus === 'PAID') {
        setShowCashInstructions(false);
        setNotice('Payment is confirmed. Your receipt is now available.');
      }
      if (methodsResult.status === 'fulfilled') {
        setMethods(methodsResult.value.data.methods);
        setError('');
      } else {
        setMethods([]);
        setError('Unable to load payment methods. The payment provider may not be configured correctly.');
      }
    } catch (requestError: unknown) {
      const message = typeof requestError === 'object' && requestError !== null
        ? (requestError as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setError(message ?? 'Unable to load this order.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  async function payForOrder() {
    if (!order || order.paymentStatus === 'PAID' || paying) return;
    setError('');
    setNotice('');
    if (order.paymentMethod !== 'STRIPE') {
      setShowCashInstructions(true);
      setNotice('Cash payments must be confirmed by an authorised cashier. This action does not mark your order as paid.');
      return;
    }
    if (!methods.some((method) => method.id === 'STRIPE')) {
      setError('Online card payment is unavailable because Stripe test credentials are not configured on the server. Your order remains unpaid; contact the restaurant or use the cashier payment flow if available.');
      return;
    }

    setPaying(true);
    try {
      const { data } = await api.post(`/customer/orders/${order.id}/checkout`);
      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }
      if (data.paymentStatus === 'PAID') {
        setNotice('Payment is confirmed. Your receipt is now available.');
      } else {
        setNotice('We are waiting for the provider’s verified payment confirmation. This page will refresh automatically.');
      }
      await refresh();
    } catch (requestError: unknown) {
      const message = typeof requestError === 'object' && requestError !== null
        ? (requestError as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setError(message ?? 'Unable to start online payment. Your order remains available for a safe retry.');
    } finally {
      setPaying(false);
    }
  }

  if (loading && !order) return <main className="page">Loading order…</main>;
  if (error && !order) return (
    <main className="page">
      <div className="alert alert-error" role="alert">{error}</div>
      <Link className="btn btn-outline" to="/customer">Back to order history</Link>
    </main>
  );
  if (!order) return <main className="page">Order unavailable.</main>;

  const paid = order.paymentStatus === 'PAID';
  const resolvedPaymentMethod = order.paymentMethod ?? 'CASH';
  const selectedMethod = methods.find((method) => method.id === resolvedPaymentMethod);

  return (
    <main className="page">
      <div className="page-header">
        <h1>Order #{order.id}</h1>
        <p>{order.branch.name} · {order.orderType.replace('_', ' ')} · {new Date(order.createdAt).toLocaleString()}</p>
      </div>
      <section className="card" aria-live="polite">
        <h2>{paid ? 'Order details' : 'Order placed'}</h2>
        <p><strong>Kitchen status:</strong> {order.status}</p>
        <p><strong>Payment status:</strong> {paymentLabel(order)}</p>
        <ul>
          {order.items.map((item, index) => (
            <li key={`${order.id}-${index}`}>
              {item.menuItem.name} × {item.quantity} · €{item.unitPrice.toFixed(2)} each · €{(item.unitPrice * item.quantity).toFixed(2)}
            </li>
          ))}
        </ul>
        <p>Subtotal: €{order.subtotal.toFixed(2)}</p>
        <p>Discount: −€{order.discountTotal.toFixed(2)}</p>
        {order.deliveryFee > 0 && <p>Delivery charge: €{order.deliveryFee.toFixed(2)}</p>}
        <p><strong>Amount due: €{(paid ? 0 : order.total).toFixed(2)} {order.currency}</strong></p>
        <p><strong>Payment method for this order:</strong> {selectedMethod?.label
          ?? (resolvedPaymentMethod === 'STRIPE' ? 'Stripe hosted checkout (test mode)' : 'Cash at the cashier')}</p>
        <div>
          <strong>Supported payment methods:</strong>
          {methods.length > 0
            ? <ul>{methods.map((method) => <li key={method.id}>{method.label}</li>)}</ul>
            : <p>Payment methods could not be loaded. Please retry.</p>}
        </div>
        {order.paymentMethod === 'STRIPE' && methods.every((method) => method.id !== 'STRIPE') && !paid && (
          <div className="alert alert-error" role="status">
            Stripe test credentials are not configured on the server. Online payment is unavailable; your order has not been paid.
          </div>
        )}
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {notice && <div className="alert alert-success" role="status">{notice}</div>}
        {showCashInstructions && resolvedPaymentMethod === 'CASH' && !paid && (
          <div className="alert" role="status">
            Please pay €{order.total.toFixed(2)} {order.currency} at the cashier for {order.branch.name}. Your order remains unpaid until an authorised cashier confirms the payment.
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
          {!paid && (
            <button className="btn btn-primary" type="button" onClick={() => void payForOrder()} disabled={paying}>
              {paying ? 'Starting secure checkout…' : 'Pay for order'}
            </button>
          )}
          {paid && <Link className="btn btn-primary" to={`/receipt/${order.id}`}>View receipt</Link>}
          <Link className="btn btn-outline" to="/customer">Order history</Link>
        </div>
      </section>
    </main>
  );
}

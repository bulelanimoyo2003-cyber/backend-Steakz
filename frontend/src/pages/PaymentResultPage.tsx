import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/axios';

interface PaymentOrder {
  id: number;
  total: number;
  subtotal: number;
  discountTotal: number;
  deliveryFee: number;
  currency: string;
  paymentStatus: string;
  paymentMethod: string | null;
}

export default function PaymentResultPage() {
  const [params] = useSearchParams();
  const orderId = Number(params.get('orderId'));
  const redirectStatus = params.get('status');
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [error, setError] = useState('');
  const paymentStatus = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      setError('The payment result does not include a valid order reference.');
      return;
    }
    try {
      const { data } = await api.get<PaymentOrder>(`/customer/orders/${orderId}/payment`);
      setOrder(data);
      paymentStatus.current = data.paymentStatus;
      setError('');
    } catch (requestError: unknown) {
      const message = typeof requestError === 'object' && requestError !== null
        ? (requestError as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setError(message ?? 'Unable to confirm this payment. Check your order history.');
    }
  }, [orderId]);

  useEffect(() => {
    let active = true;
    let attempts = 0;
    let cancellationRequested = false;
    const poll = async () => {
      if (!active) return;
      if (redirectStatus === 'cancelled' && !cancellationRequested) {
        cancellationRequested = true;
        try {
          await api.post(`/customer/orders/${orderId}/payment/cancel`);
        } catch {
          if (active) setError('Checkout returned without a confirmed cancellation. Payment status is being checked.');
        }
      }
      await refresh();
      attempts += 1;
      if (active && attempts >= 30 && paymentStatus.current !== 'PAID'
        && paymentStatus.current !== 'FAILED' && paymentStatus.current !== 'CANCELLED') {
        setError((current) => current || 'The payment provider has not confirmed the result yet. Check your order history shortly.');
      }
    };
    void poll();
    const timer = window.setInterval(() => {
      if (!['PAID', 'FAILED', 'CANCELLED'].includes(paymentStatus.current ?? 'PENDING')) void poll();
    }, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [orderId, redirectStatus, refresh]);

  const paymentText = order?.paymentStatus === 'PAID' ? 'Payment successful'
    : order?.paymentStatus === 'FAILED' ? 'Payment failed'
      : order?.paymentStatus === 'CANCELLED' ? 'Payment cancelled'
        : 'Payment pending';

  return (
    <main className="page">
      <div className="page-header">
        <h1>{paymentText}</h1>
        <p>Order #{Number.isSafeInteger(orderId) && orderId > 0 ? orderId : '—'}</p>
      </div>
      {error && <div className="alert alert-error" role="status">{error}</div>}
      {order && (
        <section className="card" aria-live="polite">
          <p>{order.paymentStatus === 'PAID'
            ? 'The payment provider confirmed your payment.'
            : order.paymentStatus === 'FAILED'
              ? 'The provider reported a declined payment. You can safely retry from your order history.'
              : order.paymentStatus === 'CANCELLED'
                ? 'Checkout was cancelled. No payment was recorded.'
                : 'We are waiting for the payment provider’s signed confirmation. A redirect by itself does not confirm payment.'}</p>
          <p>Payment method: {order.paymentMethod === 'STRIPE' ? 'Stripe hosted checkout (test mode)' : 'Cash at the cashier'}</p>
          <p>Subtotal: €{order.subtotal.toFixed(2)}</p>
          <p>Discount: −€{order.discountTotal.toFixed(2)}</p>
          {order.deliveryFee > 0 && <p>Delivery charge: €{order.deliveryFee.toFixed(2)}</p>}
          <strong>Total: €{order.total.toFixed(2)} {order.currency}</strong>
        </section>
      )}
      <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
        <Link className="btn btn-primary" to="/customer">Order history</Link>
        {order?.paymentStatus === 'PAID' && (
          <Link className="btn btn-outline" to={`/receipt/${order.id}`}>Open receipt</Link>
        )}
      </div>
    </main>
  );
}

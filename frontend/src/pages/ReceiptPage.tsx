import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../api/axios';
import { describeReceiptFailure } from './receiptAccess';

export default function ReceiptPage() {
  const { orderId } = useParams();
  const [receipt, setReceipt] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [paymentRequired, setPaymentRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    const requestId = ++requestSequence.current;
    try {
      const resp = await api.get(`/customer/receipt/${orderId}`);
      if (requestId !== requestSequence.current) return;
      setReceipt(resp.data);
      setError('');
      setPaymentRequired(false);
    } catch (requestError: unknown) {
      if (requestId !== requestSequence.current) return;
      const failure = describeReceiptFailure(requestError);
      setReceipt(null);
      setPaymentRequired(failure.kind === 'payment-required');
      setError(failure.kind === 'error' ? failure.message : '');
    } finally {
      if (requestId === requestSequence.current) setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    setReceipt(null);
    setError('');
    setPaymentRequired(false);
    setLoading(true);
    void load();
    const interval = setInterval(() => void load(), 10000);
    window.addEventListener('focus', load);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', load);
    };
  }, [load]);

  function handlePrint() {
    window.print();
  }

  function handleDownload() {
    // Browser print dialog usually provides "Save as PDF". Use that for download.
    window.print();
  }

  if (loading && !receipt) return <div className="page">Loading receipt…</div>;
  if (paymentRequired) return (
    <div className="page">
      <div className="alert alert-error" role="alert">
        Payment is required before this receipt is available. The receipt will unlock after your payment is confirmed.
      </div>
      <Link className="btn btn-primary" to={`/orders/${orderId}`}>Pay for order</Link>
      <Link className="btn btn-outline" to="/customer">Order history</Link>
    </div>
  );
  if (error) return (
    <div className="page">
      <div className="alert alert-error" role="alert">{error}</div>
      <Link className="btn btn-primary" to={`/orders/${orderId}`}>View order details</Link>
    </div>
  );
  if (!receipt) return <div className="page"><div className="alert alert-error">Receipt unavailable.</div></div>;

  return (
    <div className="page receipt-page">
      <div className="receipt-card">
        <header>
          <h2 style={{ margin: 0 }}>{receipt.restaurantName}</h2>
          <div style={{ color: 'var(--text-muted)' }}>Receipt #{receipt.receiptNumber}</div>
        </header>

        <section style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div><strong>Order ID:</strong> {receipt.orderId}</div>
              <div><strong>Customer:</strong> {receipt.customerName}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div>{new Date(receipt.dateTime).toLocaleString()}</div>
              {receipt.branchName && <div>{receipt.branchName}</div>}
            </div>
          </div>

          <table style={{ width: '100%', marginTop: '1rem', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem' }}>Item</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem' }}>Qty</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem' }}>Price</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', paddingBottom: '0.5rem' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {receipt.items.map((it: any, idx: number) => (
                <tr key={idx}>
                  <td style={{ padding: '0.5rem 0' }}>{it.name}</td>
                  <td style={{ textAlign: 'right' }}>{it.quantity}</td>
                  <td style={{ textAlign: 'right' }}>€{it.unitPrice.toFixed(2)}</td>
                  <td style={{ textAlign: 'right' }}>€{it.lineTotal.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} style={{ textAlign: 'right', paddingTop: '0.5rem' }}>Subtotal</td>
                <td style={{ textAlign: 'right', paddingTop: '0.5rem' }}>€{(receipt.subtotal ?? receipt.totalAmount).toFixed(2)}</td>
              </tr>
              <tr>
                <td colSpan={3} style={{ textAlign: 'right' }}>Discount</td>
                <td style={{ textAlign: 'right' }}>−€{(receipt.discountTotal ?? 0).toFixed(2)}</td>
              </tr>
              {(receipt.deliveryFee ?? 0) > 0 && (
                <tr>
                  <td colSpan={3} style={{ textAlign: 'right' }}>Delivery charge</td>
                  <td style={{ textAlign: 'right' }}>€{receipt.deliveryFee.toFixed(2)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={3} style={{ textAlign: 'right', paddingTop: '0.75rem', fontWeight: 700 }}>Total</td>
                <td style={{ textAlign: 'right', paddingTop: '0.75rem', fontWeight: 700 }}>€{receipt.totalAmount.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          <div style={{ marginTop: '1rem' }}>
            <div><strong>Payment status:</strong> {receipt.paymentStatus === 'PAID' ? 'Successful'
              : receipt.paymentStatus === 'FAILED' ? 'Failed'
                : receipt.paymentStatus === 'CANCELLED' ? 'Cancelled'
                  : receipt.paymentMethod === 'STRIPE' ? 'Pending'
                    : 'Awaiting cashier payment confirmation'}</div>
            <div><strong>Payment method:</strong> {receipt.paymentMethod === 'STRIPE'
              ? 'Stripe hosted checkout (test mode)'
              : 'Cash at the cashier'}</div>
            {receipt.cashierConfirmed && (
              <div><strong>Cashier confirmation:</strong> Confirmed{receipt.cashierConfirmedAt ? ` at ${new Date(receipt.cashierConfirmedAt).toLocaleString()}` : ''}</div>
            )}
          </div>

          {receipt.orderType === 'DELIVERY' && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--surface-muted, #f7f5f2)', borderRadius: 6 }}>
              <strong>Delivery progress:</strong>{' '}
              {receipt.deliveryStatus === 'DELIVERED' ? 'Delivered'
                : receipt.deliveryStatus === 'OUT_FOR_DELIVERY' ? 'Out for delivery'
                  : receipt.deliveryStatus === 'ASSIGNED' ? 'Driver assigned'
                    : 'Waiting for driver assignment'}
              {receipt.assignedDriverName && <div>Driver: {receipt.assignedDriverName}</div>}
              {receipt.deliveredAt && <div>Delivered at: {new Date(receipt.deliveredAt).toLocaleString()}</div>}
            </div>
          )}

          <div style={{ marginTop: '1.25rem', fontStyle: 'italic' }}>{receipt.thankYou}</div>
        </section>

        <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-primary" onClick={handlePrint}>Print Receipt</button>
          <button className="btn btn-ghost" onClick={handleDownload}>Download as PDF</button>
        </div>
      </div>

      <style>{`
        .receipt-card { max-width: 720px; margin: 1rem auto; padding: 1rem; background: #fff; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
        @media (max-width: 600px) { .receipt-card { padding: 0.75rem; margin: 0.75rem; } table thead { display: none; } table tbody td { display: block; width: 100%; } table tbody tr { margin-bottom: 0.5rem; border-bottom: 1px dashed #eee; padding-bottom: 0.5rem; } }
      `}</style>
    </div>
  );
}

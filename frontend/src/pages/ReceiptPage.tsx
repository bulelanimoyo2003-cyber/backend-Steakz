import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/axios';

export default function ReceiptPage() {
  const { orderId } = useParams();
  const [receipt, setReceipt] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (!orderId) return;
      try {
        const resp = await api.get(`/customer/receipt/${orderId}`);
        setReceipt(resp.data);
      } catch (e: any) {
        const msg = e?.response?.data?.error ?? 'Failed to load receipt.';
        setError(msg);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [orderId]);

  function handlePrint() {
    window.print();
  }

  function handleDownload() {
    // Browser print dialog usually provides "Save as PDF". Use that for download.
    window.print();
  }

  if (loading) return <div className="page">Loading receipt…</div>;
  if (error) return <div className="page"><div className="alert alert-error">{error}</div></div>;
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
                <td colSpan={3} style={{ textAlign: 'right', paddingTop: '0.75rem', fontWeight: 700 }}>Total</td>
                <td style={{ textAlign: 'right', paddingTop: '0.75rem', fontWeight: 700 }}>€{receipt.totalAmount.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>

          <div style={{ marginTop: '1rem' }}>
            <div><strong>Payment status:</strong> {receipt.paymentStatus}</div>
          </div>

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

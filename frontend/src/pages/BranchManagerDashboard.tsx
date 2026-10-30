import { useEffect, useState, type FormEvent } from 'react';
import api from '../api/axios';
import KpiCard from '../components/KpiCard';

interface SalesData {
  totalSales: number;
  orderCount: number;
}

interface StaffMember {
  id: number;
  name: string;
  role: string;
  salary?: number;
  isActive: boolean;
}

interface Booking {
  id: number;
  status: string;
  date: string;
  customer: { name: string };
  table: { tableNumber: number };
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
  createdAt: string;
  customer?: { name: string };
}

interface Driver {
  id: number;
  name: string;
}

interface Table {
  id: number;
  tableNumber: number;
  status: string;
}

export default function BranchManagerDashboard() {
  const [sales, setSales] = useState<SalesData | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driverName, setDriverName] = useState('');
  const [driverEmail, setDriverEmail] = useState('');
  const [driverPassword, setDriverPassword] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    const fetchDashboardData = async () => {
      try {
        const [salesResp, staffResp, ordersResp, bookingsResp, tablesResp, driversResp] = await Promise.all([
          api.get<SalesData>('/branch-manager/sales'),
          api.get<StaffMember[]>('/branch-manager/staff'),
          api.get<Order[]>('/branch-manager/orders'),
          api.get<Booking[]>('/branch-manager/bookings'),
          api.get<Table[]>('/branch-manager/tables'),
          api.get<Driver[]>('/delivery-management/drivers'),
        ]);

        if (!mounted) {
          return;
        }

        setSales(salesResp.data);
        setStaff(staffResp.data);
        setOrders(ordersResp.data);
        setBookings(bookingsResp.data);
        setTables(tablesResp.data);
        setDrivers(driversResp.data);
      } catch {
        if (mounted) {
          setError('Unable to load branch overview data.');
          setSuccess('');
        }
      }
    };

    fetchDashboardData();
    const refreshInterval = setInterval(fetchDashboardData, 10000);
    return () => {
      mounted = false;
      clearInterval(refreshInterval);
    };
  }, []);

  async function confirmBooking(id: number) {
    try {
      const response = await api.patch<Booking>(`/branch-manager/bookings/${id}/status`, { status: 'CONFIRMED' });
      setBookings((prev) => prev.map((booking) => (booking.id === id ? { ...booking, status: 'CONFIRMED' } : booking)));
      setSuccess('Booking confirmed successfully.');
      setError('');
    } catch {
      setError('Unable to confirm booking.');
      setSuccess('');
    }
  }

  async function createDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api.post('/branch-manager/staff/drivers', {
        name: driverName,
        email: driverEmail,
        password: driverPassword,
      });
      setDriverName('');
      setDriverEmail('');
      setDriverPassword('');
      setSuccess('Delivery driver created successfully.');
      setError('');
      const [staffResponse, driversResponse] = await Promise.all([
        api.get<StaffMember[]>('/branch-manager/staff'),
        api.get<Driver[]>('/delivery-management/drivers'),
      ]);
      setStaff(staffResponse.data);
      setDrivers(driversResponse.data);
    } catch (requestError: unknown) {
      const message = typeof requestError === 'object' && requestError !== null
        ? (requestError as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setError(message ?? 'Unable to create delivery driver.');
      setSuccess('');
    }
  }

  async function assignDriver(orderId: number, driverId: number) {
    try {
      const response = await api.patch<Order>(`/delivery-management/orders/${orderId}/driver`, { driverId });
      setOrders((previous) => previous.map((order) => order.id === orderId ? { ...order, ...response.data } : order));
      setSuccess('Delivery driver assigned.');
      setError('');
    } catch {
      setError('Unable to assign this driver. Refresh and check the order status.');
      setSuccess('');
    }
  }

  async function cleanTable(id: number) {
    try {
      const response = await api.patch<Table>(`/branch-manager/tables/${id}/status`, { status: 'AVAILABLE' });
      setTables((prev) => prev.map((table) => (table.id === id ? response.data : table)));
      setSuccess('Table marked as available.');
      setError('');
    } catch {
      setError('Unable to update table status.');
      setSuccess('');
    }
  }

  async function toggleStaffStatus(id: number, currentStatus: boolean) {
    try {
      await api.patch(`/branch-manager/staff/${id}/status`, { isActive: !currentStatus });
      setStaff((prev) => prev.map((s) => (s.id === id ? { ...s, isActive: !currentStatus } : s)));
    } catch {
      setError('Unable to update staff status.');
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Branch Overview</h1>
        <p>Your location at a glance</p>
      </div>

      {error && <div className="alert alert-error">⚠ {error}</div>}
      {success && <div className="alert alert-success">✓ {success}</div>}

      <div className="kpi-grid">
        <KpiCard
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h16v2H4zM4 11h10v2H4zM4 16h7v2H4z" fill="currentColor"/></svg>}
          label="Total Revenue"
          value={`€${(sales?.totalSales ?? 0).toFixed(2)}`}
          bg="linear-gradient(135deg,#1E293B,#334155)"
        />
        <KpiCard
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 13h4v8H3zM10 7h4v14h-4zM17 3h4v18h-4z" fill="currentColor"/></svg>}
          label="Completed Orders"
          value={sales?.orderCount ?? '—'}
          bg="linear-gradient(135deg,#E67E22,#F59E0B)"
        />
        <KpiCard
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 12a5 5 0 100-10 5 5 0 000 10zM2 22a10 10 0 0120 0H2z" fill="currentColor"/></svg>}
          label="Staff Members"
          value={staff.length}
          bg="linear-gradient(135deg,#06B6D4,#1E293B)"
        />
        <KpiCard
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 5h18v2H3zM3 11h10v2H3zM3 17h18v2H3z" fill="currentColor"/></svg>}
          label="Current Bookings"
          value={bookings.length}
          bg="linear-gradient(135deg,#22C55E,#10B981)"
        />
      </div>

      <div className="section-title">Staff &amp; Salaries</div>
      <div className="card" style={{ maxWidth: 620, marginBottom: '1rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Create Delivery Driver</h3>
        <form onSubmit={createDriver}>
          <div className="form-group">
            <label htmlFor="driver-name">Full name</label>
            <input id="driver-name" value={driverName} onChange={(event) => setDriverName(event.target.value)} maxLength={120} required />
          </div>
          <div className="form-group">
            <label htmlFor="driver-email">Email</label>
            <input id="driver-email" type="email" value={driverEmail} onChange={(event) => setDriverEmail(event.target.value)} required />
          </div>
          <div className="form-group">
            <label htmlFor="driver-password">Temporary password (8+ characters)</label>
            <input id="driver-password" type="password" minLength={8} value={driverPassword} onChange={(event) => setDriverPassword(event.target.value)} required />
          </div>
          <button className="btn btn-primary" type="submit">Create driver account</button>
        </form>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
        {staff.map((member) => (
          <div key={member.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', backgroundColor: 'var(--bg-elevated)', borderRadius: 'var(--radius)', marginBottom: '0.5rem', minWidth: 260 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{member.name}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{member.role}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
              <div style={{ fontSize: '0.9rem' }}>{member.salary ? <span className="price">€{member.salary}</span> : '—'}</div>
              <button className={`btn btn-sm ${member.isActive ? 'btn-outline' : 'btn-primary'}`} onClick={() => toggleStaffStatus(member.id, member.isActive)}>
                {member.isActive ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="section-title">Current Bookings</div>
      {bookings.length === 0 ? (
        <div className="empty-state">
          <span>📅</span>
          No bookings found for your location.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Booking</th>
              <th>Customer</th>
              <th>Table</th>
              <th>Date</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bookings.map((booking) => (
              <tr key={booking.id}>
                <td style={{ color: 'var(--text-muted)' }}>#{booking.id}</td>
                <td>{booking.customer.name}</td>
                <td>Table {booking.table.tableNumber}</td>
                <td>{new Date(booking.date).toLocaleString()}</td>
                <td><span className={`badge badge-${booking.status.toLowerCase()}`}>{booking.status}</span></td>
                <td>
                  {booking.status === 'PENDING' ? (
                    <button className="btn btn-sm btn-primary" onClick={() => confirmBooking(booking.id)}>
                      Confirm
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="section-title">Table Status</div>
      {tables.length === 0 ? (
        <div className="empty-state">
          <span>🪑</span>
          No tables found for your location.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Table</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tables.map((table) => (
              <tr key={table.id}>
                <td>Table {table.tableNumber}</td>
                <td><span className={`badge badge-${table.status.toLowerCase()}`}>{table.status}</span></td>
                <td>
                  {table.status === 'CLEANING' ? (
                    <button className="btn btn-sm btn-primary" onClick={() => cleanTable(table.id)}>
                      Mark Available
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="section-title">All Branch Orders</div>
      {orders.length === 0 ? (
        <div className="empty-state">
          <span>📦</span>
          No orders found for your location.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Order</th><th>Customer</th><th>Total</th><th>Preparation</th><th>Delivery</th><th>Date</th></tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const preparationStatus = order.orderType === 'DELIVERY' && order.deliveryStatus === 'DELIVERED'
                ? 'DONE'
                : order.status;
              return (
                <tr key={order.id}>
                  <td style={{ color: 'var(--text-muted)' }}>#{order.id}</td>
                  <td>{order.customer?.name ?? 'Walk-in'}</td>
                  <td><span className="price" style={{ fontSize: '0.95rem' }}>€{order.total.toFixed(2)}</span></td>
                  <td><span className={`badge badge-${preparationStatus.toLowerCase()}`}>{preparationStatus}</span></td>
                  <td>
                  {order.orderType === 'DELIVERY' ? (
                    <div className="delivery-order-cell">
                      <div>{order.recipientName} · {order.recipientPhone}</div>
                      <div>{order.deliveryAddress}</div>
                      {order.deliveryInstructions && <small>Instructions: {order.deliveryInstructions}</small>}
                      <div className="delivery-assignment">
                        <span className={`badge badge-${(order.deliveryStatus ?? 'unassigned').toLowerCase()}`}>
                          {order.deliveryStatus ?? 'UNASSIGNED'}
                        </span>
                        <select
                          aria-label={`Assign driver to order ${order.id}`}
                          value={order.assignedDriver?.id ?? ''}
                          disabled={order.status === 'CANCELLED' || order.status === 'DELIVERED'
                            || order.deliveryStatus === 'OUT_FOR_DELIVERY' || order.deliveryStatus === 'DELIVERED'}
                          onChange={(event) => {
                            if (event.target.value) void assignDriver(order.id, Number(event.target.value));
                          }}
                        >
                          <option value="">Assign driver</option>
                          {drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}
                        </select>
                        <span>{order.assignedDriver?.name ?? 'No driver assigned'}</span>
                      </div>
                    </div>
                  ) : <span>{order.orderType.replace('_', ' ')}</span>}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{new Date(order.createdAt).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

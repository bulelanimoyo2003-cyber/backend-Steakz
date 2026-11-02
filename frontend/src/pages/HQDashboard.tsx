import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

interface BranchSales {
  branchId: number;
  branchName: string;
  totalSales: number;
  orderCount: number;
}

interface StaffMember {
  id: number;
  name: string;
  role: string;
  salary?: number;
  branch?: { name: string };
}

interface Order {
  id: number;
  status: string;
  orderType: string;
  deliveryStatus: string | null;
  assignedDriver?: { id: number; name: string } | null;
  total: number;
  createdAt: string;
  branch: { id: number; name: string };
}

export default function HQDashboard() {
  const { user } = useAuth();
  const [sales, setSales] = useState<BranchSales[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [error, setError] = useState('');
  const requestGeneration = useRef(0);

  const loadOverview = useCallback(async () => {
    const generation = requestGeneration.current;
    try {
      const [salesResponse, staffResponse, ordersResponse] = await Promise.all([
        api.get<BranchSales[]>('/hq/sales'),
        api.get<StaffMember[]>('/hq/staff'),
        api.get<Order[]>('/hq/orders'),
      ]);
      if (generation === requestGeneration.current) {
        setSales(salesResponse.data);
        setStaff(staffResponse.data);
        setOrders(ordersResponse.data);
        setError('');
      }
    } catch {
      if (generation === requestGeneration.current) setError('Unable to load the HQ overview.');
    }
  }, [user?.id]);

  useEffect(() => {
    requestGeneration.current += 1;
    setSales([]);
    setStaff([]);
    setOrders([]);
    setError('');
    void loadOverview();
    const refreshVisibleTab = () => {
      if (document.visibilityState === 'visible') void loadOverview();
    };
    const interval = setInterval(refreshVisibleTab, 10000);
    window.addEventListener('focus', loadOverview);
    document.addEventListener('visibilitychange', refreshVisibleTab);
    return () => {
      requestGeneration.current += 1;
      clearInterval(interval);
      window.removeEventListener('focus', loadOverview);
      document.removeEventListener('visibilitychange', refreshVisibleTab);
    };
  }, [loadOverview, user?.id]);

  const totalRevenue = sales.reduce((sum, branch) => sum + branch.totalSales, 0);
  const totalOrders = sales.reduce((sum, branch) => sum + branch.orderCount, 0);

  return (
    <div className="page">
      <div className="page-header">
        <h1>HQ Overview</h1>
        <p>Consolidated view across all branches</p>
      </div>

      {error && <div className="alert alert-error">⚠ {error}</div>}

      <div className="stat-grid">
        <div className="stat-box">
          <div className="stat-value">€{totalRevenue.toFixed(0)}</div>
          <div className="stat-label">Total Revenue</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{totalOrders}</div>
          <div className="stat-label">Total Orders</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{staff.length}</div>
          <div className="stat-label">Total Staff</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{sales.length}</div>
          <div className="stat-label">Active Locations</div>
        </div>
      </div>

      <div className="section-title">Sales by Location</div>
      <table className="data-table">
        <thead>
          <tr><th>Location</th><th>Orders</th><th>Revenue</th></tr>
        </thead>
        <tbody>
          {sales.map((branch) => (
            <tr key={branch.branchId}>
              <td>{branch.branchName}</td>
              <td>{branch.orderCount}</td>
              <td><span className="price" style={{ fontSize: '0.95rem' }}>€{branch.totalSales.toFixed(2)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="section-title">Order Overview</div>
      {orders.length === 0 ? (
        <div className="empty-state">
          <span>📈</span>
          No recent orders available.
        </div>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Order</th><th>Location</th><th>Status</th><th>Delivery / driver</th><th>Total</th></tr>
          </thead>
          <tbody>
            {orders.slice(0, 10).map((order) => (
              <tr key={order.id}>
                <td>#{order.id}</td>
                <td>{order.branch.name}</td>
                <td>
                  {order.orderType === 'DELIVERY' ? (
                    <span className={`badge badge-${(order.status === 'DELIVERED' ? 'done' : order.status).toLowerCase()}`}>
                      Kitchen: {order.status === 'DELIVERED' ? 'DONE' : order.status}
                    </span>
                  ) : <span className={`badge badge-${order.status.toLowerCase()}`}>{order.status}</span>}
                </td>
                <td>
                  {order.orderType === 'DELIVERY' ? (
                    <div className="delivery-assignment">
                      <span>{order.deliveryStatus === 'DELIVERED' || order.status === 'DELIVERED' ? 'Delivered'
                        : order.deliveryStatus === 'ASSIGNED'
                        ? (order.status === 'DONE' || order.status === 'DELIVERED' ? 'Ready for pickup' : 'Driver assigned — awaiting preparation')
                        : order.deliveryStatus === 'OUT_FOR_DELIVERY' ? 'Out for delivery'
                          : 'Waiting for driver assignment'}</span>
                      <span>{order.assignedDriver?.name ?? 'No driver assigned'}</span>
                    </div>
                  ) : <span>{order.orderType.replace('_', ' ')}</span>}
                </td>
                <td><span className="price">€{order.total.toFixed(2)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="section-title">Staff Overview</div>
      <table className="data-table">
        <thead>
          <tr><th>Name</th><th>Role</th><th>Location</th><th>Salary</th></tr>
        </thead>
        <tbody>
          {staff.map((member) => (
            <tr key={member.id}>
              <td>{member.name}</td>
              <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{member.role}</td>
              <td>{member.branch?.name ?? 'HQ'}</td>
              <td>{member.salary ? <span className="price" style={{ fontSize: '0.95rem' }}>€{member.salary}</span> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import api from '../api/axios';
import KpiCard from '../components/KpiCard';
import { useAuth } from '../context/AuthContext';

interface Branch {
  id: number;
  name: string;
  address: string;
  isActive: boolean;
}

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
  branchId: number;
  branch: { name: string };
}

interface Booking {
  id: number;
  status: string;
  date: string;
  customer: { name: string };
  table: { tableNumber: number; branch: { id: number; name: string } };
}

interface Order {
  id: number;
  branchId: number;
  branch: { id: number; name: string };
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
  branchId: number;
}

interface Table {
  id: number;
  tableNumber: number;
  status: string;
  branch: { id: number; name: string };
}

interface MenuItem {
  id: number;
  name: string;
  description: string | null;
  price: number;
  category: string;
  isAvailable: boolean;
  branchId: number;
}

function branchConfig(branchId: number) {
  return { headers: { 'X-Branch-Id': String(branchId) } };
}

export default function BranchManagerDashboard() {
  const { user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState('all');
  const [sales, setSales] = useState<SalesData>({ totalSales: 0, orderCount: 0 });
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [tables, setTables] = useState<Table[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [driverName, setDriverName] = useState('');
  const [driverEmail, setDriverEmail] = useState('');
  const [driverPassword, setDriverPassword] = useState('');
  const [menuName, setMenuName] = useState('');
  const [menuDescription, setMenuDescription] = useState('');
  const [menuPrice, setMenuPrice] = useState('');
  const [menuCategory, setMenuCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const dashboardRequest = useRef({ id: 0, key: '' });

  const loadDashboardData = useCallback(async (assignedBranches: Branch[], selection: string) => {
    const requestKey = selection === 'all'
      ? `branches:${assignedBranches.map((branch) => branch.id).sort((a, b) => a - b).join(',')}`
      : `branch:${selection}`;
    const selectionChanged = dashboardRequest.current.key !== requestKey;
    const requestId = dashboardRequest.current.id + 1;
    dashboardRequest.current = { id: requestId, key: requestKey };
    if (selectionChanged) {
      setSales({ totalSales: 0, orderCount: 0 });
      setStaff([]);
      setOrders([]);
      setBookings([]);
      setTables([]);
      setDrivers([]);
      setMenuItems([]);
      setError('');
    }
    const isCurrentRequest = () => dashboardRequest.current.id === requestId
      && dashboardRequest.current.key === requestKey;
    const scopedBranches = selection === 'all'
      ? assignedBranches
      : assignedBranches.filter((branch) => branch.id === Number(selection));
    if (scopedBranches.length === 0) {
      if (isCurrentRequest()) {
        setLoading(false);
        setError('No assigned location is available.');
      }
      return;
    }

    setLoading(true);
    try {
      const byBranch = await Promise.all(scopedBranches.map(async (branch) => {
        const config = branchConfig(branch.id);
        const [salesResponse, staffResponse, ordersResponse, bookingsResponse, tablesResponse, driversResponse, menuResponse] = await Promise.all([
          api.get<SalesData>('/branch-manager/sales', config),
          api.get<StaffMember[]>('/branch-manager/staff', config),
          api.get<Order[]>('/branch-manager/orders', config),
          api.get<Booking[]>('/branch-manager/bookings', config),
          api.get<Table[]>('/branch-manager/tables', config),
          api.get<Driver[]>('/delivery-management/drivers', config),
          api.get<MenuItem[]>('/branch-manager/menu', config),
        ]);
        return {
          branch,
          sales: salesResponse.data,
          staff: staffResponse.data,
          orders: ordersResponse.data,
          bookings: bookingsResponse.data,
          tables: tablesResponse.data,
          drivers: driversResponse.data,
          menu: menuResponse.data,
        };
      }));

      if (!isCurrentRequest()) return;
      setSales({
        totalSales: byBranch.reduce((sum, item) => sum + item.sales.totalSales, 0),
        orderCount: byBranch.reduce((sum, item) => sum + item.sales.orderCount, 0),
      });
      setStaff(byBranch.flatMap(({ branch, staff: members }) => members.map((member) => ({
        ...member,
        branchId: branch.id,
        branch: { name: branch.name },
      }))));
      setOrders(byBranch.flatMap(({ orders: branchOrders }) => branchOrders));
      setBookings(byBranch.flatMap(({ bookings: branchBookings }) => branchBookings));
      setTables(byBranch.flatMap(({ tables: branchTables }) => branchTables));
      setDrivers(byBranch.flatMap(({ branch, drivers: branchDrivers }) => branchDrivers.map((driver) => ({
        ...driver,
        branchId: branch.id,
      }))));
      setMenuItems(byBranch.flatMap(({ branch, menu }) => menu.map((item) => ({
        ...item,
        branchId: branch.id,
      }))));
      setError('');
    } catch (requestError: unknown) {
      if (!isCurrentRequest()) return;
      const message = typeof requestError === 'object' && requestError !== null
        ? (requestError as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setError(message ?? 'Unable to load branch overview data.');
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    api.get<Branch[]>('/branch-manager/branches')
      .then((response) => {
        if (!mounted) return;
        setBranches(response.data);
      })
      .catch(() => {
        if (mounted) {
          setLoading(false);
          setError('Unable to load assigned locations.');
        }
      });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (branches.length === 0) return;
    void loadDashboardData(branches, selectedBranchId);
  }, [branches, loadDashboardData, selectedBranchId]);

  useEffect(() => {
    if (branches.length === 0) return undefined;
    const refresh = setInterval(() => {
      void loadDashboardData(branches, selectedBranchId);
    }, 10000);
    return () => clearInterval(refresh);
  }, [branches, loadDashboardData, selectedBranchId]);

  const selectedBranch = selectedBranchId === 'all'
    ? null
    : branches.find((branch) => branch.id === Number(selectedBranchId)) ?? null;
  const canChangeBranchRecords = selectedBranch !== null;

  async function confirmBooking(id: number, branchId: number) {
    try {
      await api.patch(`/branch-manager/bookings/${id}/status`, { status: 'CONFIRMED' }, branchConfig(branchId));
      setBookings((previous) => previous.map((booking) => booking.id === id ? { ...booking, status: 'CONFIRMED' } : booking));
      setSuccess('Reservation confirmed.');
      setError('');
    } catch {
      setError('Unable to confirm reservation for this location.');
      setSuccess('');
    }
  }

  async function createDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBranch) {
      setError('Select a specific location before creating a delivery driver.');
      return;
    }
    try {
      await api.post('/branch-manager/staff/drivers', {
        name: driverName,
        email: driverEmail,
        password: driverPassword,
      }, branchConfig(selectedBranch.id));
      setDriverName('');
      setDriverEmail('');
      setDriverPassword('');
      setSuccess(`Delivery driver created for ${selectedBranch.name}.`);
      setError('');
      await loadDashboardData(branches, selectedBranchId);
    } catch (requestError: unknown) {
      const message = typeof requestError === 'object' && requestError !== null
        ? (requestError as { response?: { data?: { error?: string } } }).response?.data?.error
        : undefined;
      setError(message ?? 'Unable to create delivery driver.');
      setSuccess('');
    }
  }

  async function assignDriver(order: Order, driverId: number) {
    try {
      const response = await api.patch<Order>(
        `/delivery-management/orders/${order.id}/driver`,
        { driverId },
        branchConfig(order.branchId),
      );
      setOrders((previous) => previous.map((candidate) => candidate.id === order.id
        ? { ...candidate, ...response.data }
        : candidate));
      setSuccess(`Driver assigned to order #${order.id} at ${order.branch.name}.`);
      setError('');
    } catch {
      setError('Unable to assign this driver. Confirm the selected branch and reload the order.');
      setSuccess('');
    }
  }

  async function cleanTable(table: Table) {
    try {
      await api.patch(`/branch-manager/tables/${table.id}/status`, { status: 'AVAILABLE' }, branchConfig(table.branch.id));
      setTables((previous) => previous.map((candidate) => candidate.id === table.id
        ? { ...candidate, status: 'AVAILABLE' }
        : candidate));
      setSuccess(`Table ${table.tableNumber} at ${table.branch.name} is available.`);
      setError('');
    } catch {
      setError('Unable to update table status for this location.');
      setSuccess('');
    }
  }

  async function toggleStaffStatus(member: StaffMember) {
    try {
      await api.patch(`/branch-manager/staff/${member.id}/status`, { isActive: !member.isActive }, branchConfig(member.branchId));
      setStaff((previous) => previous.map((candidate) => candidate.id === member.id
        ? { ...candidate, isActive: !member.isActive }
        : candidate));
      setSuccess(`Updated ${member.name} at ${member.branch.name}.`);
      setError('');
    } catch {
      setError('Unable to update staff status for this location.');
    }
  }

  async function createMenuItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedBranch) {
      setError('Select a specific location before changing its menu.');
      return;
    }
    try {
      await api.post('/branch-manager/menu', {
        name: menuName,
        description: menuDescription,
        price: Number(menuPrice),
        category: menuCategory,
      }, branchConfig(selectedBranch.id));
      setMenuName('');
      setMenuDescription('');
      setMenuPrice('');
      setMenuCategory('');
      setSuccess(`Menu item added to ${selectedBranch.name}.`);
      setError('');
      await loadDashboardData(branches, selectedBranchId);
    } catch {
      setError('Unable to add this menu item.');
    }
  }

  async function toggleMenuAvailability(item: MenuItem) {
    try {
      const response = await api.patch<MenuItem>(`/branch-manager/menu/${item.id}`, {
        isAvailable: !item.isAvailable,
      }, branchConfig(item.branchId));
      setMenuItems((previous) => previous.map((candidate) => candidate.id === item.id ? response.data : candidate));
      setSuccess(`Menu availability updated for ${item.name}.`);
      setError('');
    } catch {
      setError('Unable to update this menu item.');
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Branch Manager Overview</h1>
        <p>Manage your assigned locations. Select one location to make changes.</p>
        <div className="form-group" style={{ maxWidth: 420 }}>
          <label htmlFor="manager-location">Location</label>
          <select
            id="manager-location"
            value={selectedBranchId}
            onChange={(event) => {
              setSelectedBranchId(event.target.value);
              setSuccess('');
              setError('');
            }}
          >
            <option value="all">All locations overview</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}{branch.isActive ? '' : ' (inactive — existing work only)'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <div className="alert alert-error">⚠ {error}</div>}
      {success && <div className="alert alert-success">✓ {success}</div>}
      {selectedBranch && !selectedBranch.isActive && (
        <div className="alert alert-info">
          {selectedBranch.name} is inactive for new customer orders and reservations. Existing work can still be managed.
        </div>
      )}
      {!canChangeBranchRecords && branches.length > 1 && (
        <div className="alert alert-info">All-location view is read-only. Choose a specific location before changing records.</div>
      )}
      {loading && <div className="empty-state">Loading location data…</div>}

      <div className="kpi-grid">
        <KpiCard
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6h16v2H4zM4 11h10v2H4zM4 16h7v2H4z" fill="currentColor"/></svg>}
          label="Completed Revenue"
          value={`€${sales.totalSales.toFixed(2)}`}
          bg="linear-gradient(135deg,#1E293B,#334155)"
        />
        <KpiCard
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 13h4v8H3zM10 7h4v14h-4zM17 3h4v18h-4z" fill="currentColor"/></svg>}
          label="Completed Orders"
          value={sales.orderCount}
          bg="linear-gradient(135deg,#E67E22,#F59E0B)"
        />
        <KpiCard
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 12a5 5 0 100-10 5 5 0 000 10zM2 22a10 10 0 0120 0H2z" fill="currentColor"/></svg>}
          label="Staff Members"
          value={new Set(staff.map((member) => member.id)).size}
          bg="linear-gradient(135deg,#06B6D4,#1E293B)"
        />
        <KpiCard
          icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 5h18v2H3zM3 11h10v2H3zM3 17h18v2H3z" fill="currentColor"/></svg>}
          label="Reservations"
          value={bookings.length}
          bg="linear-gradient(135deg,#22C55E,#10B981)"
        />
      </div>

      <div className="section-title">Staff &amp; Delivery Drivers</div>
      <div className="card" style={{ maxWidth: 620, marginBottom: '1rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Create Delivery Driver{selectedBranch ? ` — ${selectedBranch.name}` : ''}</h3>
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
          <button className="btn btn-primary" type="submit" disabled={!canChangeBranchRecords}>
            Create driver account
          </button>
        </form>
      </div>
      <div className="card-grid">
        {staff.map((member) => (
          <div key={`${member.branchId}-${member.id}`} className="card" style={{ minWidth: 260 }}>
            <div className="card-label">{member.branch.name}</div>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{member.name}</div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{member.role}</div>
            <div style={{ marginTop: '0.5rem' }}>{member.salary ? <span className="price">€{member.salary}</span> : '—'}</div>
            <button
              className={`btn btn-sm ${member.isActive ? 'btn-outline' : 'btn-primary'}`}
              disabled={!canChangeBranchRecords || member.branchId !== selectedBranch?.id || member.id === user?.id}
              onClick={() => void toggleStaffStatus(member)}
            >
              {member.isActive ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        ))}
      </div>

      <div className="section-title">Reservations</div>
      {bookings.length === 0 ? <div className="empty-state">No reservations found in this view.</div> : (
        <table className="data-table">
          <thead><tr><th>Location</th><th>Booking</th><th>Customer</th><th>Table</th><th>Date</th><th>Status</th><th /></tr></thead>
          <tbody>{bookings.map((booking) => (
            <tr key={booking.id}>
              <td>{booking.table.branch.name}</td>
              <td>#{booking.id}</td>
              <td>{booking.customer.name}</td>
              <td>Table {booking.table.tableNumber}</td>
              <td>{new Date(booking.date).toLocaleString()}</td>
              <td><span className={`badge badge-${booking.status.toLowerCase()}`}>{booking.status}</span></td>
              <td>{booking.status === 'PENDING' ? (
                <button className="btn btn-sm btn-primary" disabled={!canChangeBranchRecords || booking.table.branch.id !== selectedBranch?.id} onClick={() => void confirmBooking(booking.id, booking.table.branch.id)}>Confirm</button>
              ) : null}</td>
            </tr>
          ))}</tbody>
        </table>
      )}

      <div className="section-title">Table Status</div>
      {tables.length === 0 ? <div className="empty-state">No tables found in this view.</div> : (
        <table className="data-table">
          <thead><tr><th>Location</th><th>Table</th><th>Status</th><th /></tr></thead>
          <tbody>{tables.map((table) => (
            <tr key={table.id}>
              <td>{table.branch.name}</td>
              <td>Table {table.tableNumber}</td>
              <td><span className={`badge badge-${table.status.toLowerCase()}`}>{table.status}</span></td>
              <td>{table.status === 'CLEANING' ? (
                <button className="btn btn-sm btn-primary" disabled={!canChangeBranchRecords || table.branch.id !== selectedBranch?.id} onClick={() => void cleanTable(table)}>Mark Available</button>
              ) : null}</td>
            </tr>
          ))}</tbody>
        </table>
      )}

      <div className="section-title">Menu Management</div>
      {selectedBranch && (
        <div className="card" style={{ maxWidth: 720, marginBottom: '1rem' }}>
          <h3>Add menu item — {selectedBranch.name}</h3>
          <form onSubmit={createMenuItem}>
            <div className="form-group"><label htmlFor="menu-name">Name</label><input id="menu-name" value={menuName} onChange={(event) => setMenuName(event.target.value)} required /></div>
            <div className="form-group"><label htmlFor="menu-description">Description</label><input id="menu-description" value={menuDescription} onChange={(event) => setMenuDescription(event.target.value)} /></div>
            <div className="form-group"><label htmlFor="menu-price">Price</label><input id="menu-price" type="number" min="0.01" step="0.01" value={menuPrice} onChange={(event) => setMenuPrice(event.target.value)} required /></div>
            <div className="form-group"><label htmlFor="menu-category">Category</label><input id="menu-category" value={menuCategory} onChange={(event) => setMenuCategory(event.target.value)} required /></div>
            <button className="btn btn-primary" type="submit">Add menu item</button>
          </form>
        </div>
      )}
      {menuItems.length === 0 ? <div className="empty-state">No menu items found in this view.</div> : (
        <table className="data-table">
          <thead><tr><th>Location</th><th>Item</th><th>Category</th><th>Price</th><th>Availability</th><th /></tr></thead>
          <tbody>{menuItems.map((item) => (
            <tr key={`${item.branchId}-${item.id}`}>
              <td>{branches.find((branch) => branch.id === item.branchId)?.name ?? 'Unknown location'}</td>
              <td>{item.name}</td>
              <td>{item.category}</td>
              <td>€{item.price.toFixed(2)}</td>
              <td>{item.isAvailable ? 'Available' : 'Unavailable'}</td>
              <td><button className="btn btn-sm btn-outline" disabled={!canChangeBranchRecords || item.branchId !== selectedBranch?.id} onClick={() => void toggleMenuAvailability(item)}>{item.isAvailable ? 'Mark unavailable' : 'Mark available'}</button></td>
            </tr>
          ))}</tbody>
        </table>
      )}

      <div className="section-title">Orders &amp; Deliveries</div>
      {orders.length === 0 ? <div className="empty-state">No orders found in this view.</div> : (
        <table className="data-table">
          <thead><tr><th>Location</th><th>Order</th><th>Customer</th><th>Total</th><th>Preparation</th><th>Delivery / collection</th><th>Date</th></tr></thead>
          <tbody>{orders.map((order) => {
            const preparationStatus = order.orderType === 'DELIVERY' && order.deliveryStatus === 'DELIVERED'
              ? 'DONE'
              : order.status;
            return (
              <tr key={`${order.branchId}-${order.id}`}>
                <td>{order.branch.name}</td>
                <td>#{order.id}</td>
                <td>{order.customer?.name ?? 'Walk-in'}</td>
                <td><span className="price">€{order.total.toFixed(2)}</span></td>
                <td><span className={`badge badge-${preparationStatus.toLowerCase()}`}>{preparationStatus}</span></td>
                <td>{order.orderType === 'DELIVERY' ? (
                  <div className="delivery-order-cell">
                    <div>{order.recipientName} · {order.recipientPhone}</div>
                    <div>{order.deliveryAddress}</div>
                    {order.deliveryInstructions && <small>Instructions: {order.deliveryInstructions}</small>}
                    <div className="delivery-assignment">
                      <span className={`badge badge-${(order.deliveryStatus ?? 'unassigned').toLowerCase()}`}>{order.deliveryStatus ?? 'UNASSIGNED'}</span>
                      <select
                        aria-label={`Assign driver to order ${order.id} at ${order.branch.name}`}
                        value={order.assignedDriver?.id ?? ''}
                        disabled={!canChangeBranchRecords || order.branchId !== selectedBranch?.id || order.status === 'CANCELLED'
                          || order.status === 'DELIVERED' || order.deliveryStatus === 'OUT_FOR_DELIVERY' || order.deliveryStatus === 'DELIVERED'}
                        onChange={(event) => { if (event.target.value) void assignDriver(order, Number(event.target.value)); }}
                      >
                        <option value="">Assign driver</option>
                        {drivers.filter((driver) => driver.branchId === order.branchId).map((driver) => (
                          <option key={driver.id} value={driver.id}>{driver.name}</option>
                        ))}
                      </select>
                      <span>{order.assignedDriver?.name ?? 'No driver assigned'}</span>
                    </div>
                  </div>
                ) : <span>{order.orderType.replace('_', ' ')}</span>}</td>
                <td>{new Date(order.createdAt).toLocaleDateString()}</td>
              </tr>
            );
          })}</tbody>
        </table>
      )}
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import api from '../api/axios';

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  branchId?: number;
  salary?: number;
  branch?: { name: string };
}

interface Branch {
  id: number;
  name: string;
  address: string;
  isActive: boolean;
}

const ROLES = ['ADMIN', 'HQ_MANAGER', 'BRANCH_MANAGER', 'CHEF', 'CASHIER', 'DELIVERY_DRIVER', 'CUSTOMER'];

export default function AdminDashboard() {
  const [users, setUsers] = useState<User[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [uName, setUName] = useState('');
  const [uEmail, setUEmail] = useState('');
  const [uPass, setUPass] = useState('');
  const [uRole, setURole] = useState('CASHIER');
  const [uBranch, setUBranch] = useState('');
  const [uSalary, setUSalary] = useState('');
  const [uMsg, setUMsg] = useState('');
  const [bName, setBName] = useState('');
  const [bAddress, setBAddress] = useState('');
  const [bMsg, setBMsg] = useState('');

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    try {
      const [usersResponse, branchesResponse] = await Promise.all([api.get<User[]>('/admin/users'), api.get<Branch[]>('/admin/branches')]);
      setUsers(usersResponse.data);
      setBranches(branchesResponse.data);
    } catch {
      setUMsg('Unable to load admin data.');
    }
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUMsg('');

    try {
      await api.post('/admin/users', {
        name: uName,
        email: uEmail,
        password: uPass,
        role: uRole,
        branchId: uBranch ? Number(uBranch) : undefined,
        salary: uSalary ? Number(uSalary) : undefined,
      });
      setUMsg('User created successfully.');
      setUName('');
      setUEmail('');
      setUPass('');
      setUBranch('');
      setUSalary('');
      loadAll();
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err !== null && 'response' in err && (err as any).response?.data?.error
          ? (err as any).response.data.error
          : 'Failed.';
      setUMsg(message);
    }
  }

  async function addBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBMsg('');

    try {
      await api.post('/admin/branches', { name: bName, address: bAddress });
      setBMsg('Location added.');
      setBName('');
      setBAddress('');
      loadAll();
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err !== null && 'response' in err && (err as any).response?.data?.error
          ? (err as any).response.data.error
          : 'Failed.';
      setBMsg(message);
    }
  }

  async function changeRole(id: number, role: string) {
    const branchId = users.find((user) => user.id === id)?.branchId;
    await api.patch(`/admin/users/${id}/role`, { role, branchId });
    loadAll();
  }

  async function toggleUser(id: number, isActive: boolean) {
    await api.patch(`/admin/users/${id}/${isActive ? 'disable' : 'enable'}`);
    loadAll();
  }

  async function deleteUser(id: number) {
    if (!window.confirm('Permanently delete this user?')) return;
    await api.delete(`/admin/users/${id}`);
    loadAll();
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Admin Panel</h1>
        <p>System-wide user and location management</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2.5rem' }}>
        <div className="card">
          <h2 style={{ marginBottom: '1.25rem' }}>Create User</h2>
          {uMsg && (
            <div className={`alert ${uMsg.includes('success') ? 'alert-success' : 'alert-error'}`}>{uMsg}</div>
          )}
          <form onSubmit={createUser}>
            <div className="form-group"><label>Name</label><input value={uName} onChange={(event) => setUName(event.target.value)} placeholder="Full name" required /></div>
            <div className="form-group"><label>Email</label><input type="email" value={uEmail} onChange={(event) => setUEmail(event.target.value)} placeholder="email@example.com" required /></div>
            <div className="form-group"><label>Password</label><input type="password" value={uPass} onChange={(event) => setUPass(event.target.value)} placeholder="••••••••" required /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>Role</label>
                <select value={uRole} onChange={(event) => setURole(event.target.value)}>
                  {ROLES.map((role) => (<option key={role} value={role}>{role}</option>))}
                </select>
              </div>
              <div className="form-group">
                <label>Salary</label>
                <input type="number" value={uSalary} onChange={(event) => setUSalary(event.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div className="form-group">
              <label>Location (staff only)</label>
              <select value={uBranch} onChange={(event) => setUBranch(event.target.value)}>
                <option value="">— None —</option>
                {branches.map((branch) => (<option key={branch.id} value={branch.id}>{branch.name}</option>))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Create User</button>
          </form>
        </div>

        <div className="card">
          <h2 style={{ marginBottom: '1.25rem' }}>Add Location</h2>
          {bMsg && (
            <div className={`alert ${bMsg.includes('added') ? 'alert-success' : 'alert-error'}`}>{bMsg}</div>
          )}
          <form onSubmit={addBranch}>
            <div className="form-group"><label>Location Name</label><input value={bName} onChange={(event) => setBName(event.target.value)} placeholder="Steakz ..." required /></div>
            <div className="form-group"><label>Address</label><input value={bAddress} onChange={(event) => setBAddress(event.target.value)} placeholder="Street, District" required /></div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Add Location</button>
          </form>

          <div className="section-title" style={{ marginTop: '1.5rem' }}>All Locations</div>
          {branches.map((branch) => (
            <div key={branch.id} style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <span style={{ color: 'var(--cognac)', fontSize: '0.7rem' }}>✦</span>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{branch.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="section-title">All Users</div>
      <table className="data-table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th><th>Location</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id}>
              <td>{user.name}</td>
              <td style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{user.email}</td>
              <td>
                <select
                  value={user.role}
                  onChange={(event) => changeRole(user.id, event.target.value)}
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', padding: '3px 8px', borderRadius: 'var(--radius-sm)', fontSize: '0.82rem' }}
                >
                  {ROLES.map((role) => (<option key={role} value={role}>{role}</option>))}
                </select>
              </td>
              <td style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>{user.branch?.name ?? '—'}</td>
              <td>
                <span className={`badge badge-${user.isActive ? 'confirmed' : 'cancelled'}`}>
                  {user.isActive ? 'Active' : 'Disabled'}
                </span>
              </td>
              <td style={{ display: 'flex', gap: '0.4rem' }}>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => toggleUser(user.id, user.isActive)}>
                  {user.isActive ? 'Disable' : 'Enable'}
                </button>
                <button className="btn btn-danger btn-sm" type="button" onClick={() => deleteUser(user.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

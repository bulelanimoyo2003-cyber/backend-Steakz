import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';

const ROLE_DASH: Record<string, string> = {
  ADMIN: '/admin',
  HQ_MANAGER: '/hq',
  BRANCH_MANAGER: '/branch-manager',
  CHEF: '/chef',
  CASHIER: '/cashier',
  CUSTOMER: '/customer',
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    try {
      const { data } = await api.post('/auth/login', { email, password });
      if (!data?.token || !data?.user) {
        throw new Error('Invalid server response.');
      }
      login(data.token, data.user);
      navigate(ROLE_DASH[data.user.role] ?? '/');
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err !== null
          ? (err as any).response?.data?.error || (err as any).message || 'Sign in failed.'
          : 'Sign in failed.';
      setError(message);
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-box">
        <span className="card-label" style={{ display: 'block', textAlign: 'center', marginBottom: '0.5rem' }}>
          Welcome back
        </span>
        <h2 style={{ textAlign: 'center', marginBottom: '0.3rem' }}>Sign In</h2>
        <p style={{ textAlign: 'center' }}>Access your Steakz account</p>
        {error && <div className="alert alert-error">⚠ {error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email Address</label>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" required />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}>
            Sign In
          </button>
        </form>
        <div className="auth-divider">or</div>
        <p style={{ textAlign: 'center', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          No account?{' '}
          <Link to="/register" style={{ color: 'var(--cognac-light)', textDecoration: 'none', fontWeight: 600 }}>
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

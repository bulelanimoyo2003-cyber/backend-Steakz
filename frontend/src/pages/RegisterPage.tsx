import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import api from '../api/axios';

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');

    try {
      await api.post('/auth/register', { name, email, password });
      setSuccess('Account created. Redirecting to sign in…');
      setTimeout(() => navigate('/login'), 1500);
    } catch (err: unknown) {
      const message =
        typeof err === 'object' && err !== null && 'response' in err && (err as any).response?.data?.error
          ? (err as any).response.data.error
          : 'Registration failed.';
      setError(message);
    }
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-box">
        <span className="card-label" style={{ display: 'block', textAlign: 'center', marginBottom: '0.5rem' }}>
          Join Steakz
        </span>
        <h2 style={{ textAlign: 'center', marginBottom: '0.3rem' }}>Create Account</h2>
        <p style={{ textAlign: 'center' }}>Start reserving a table at an active Steakz location</p>
        {error && <div className="alert alert-error">⚠ {error}</div>}
        {success && <div className="alert alert-success">✓ {success}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Full Name</label>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" required />
          </div>
          <div className="form-group">
            <label>Email Address</label>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••" required />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}>
            Create Account
          </button>
        </form>
        <div className="auth-divider">or</div>
        <p style={{ textAlign: 'center', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
          Already a member?{' '}
          <Link to="/login" style={{ color: 'var(--cognac-light)', textDecoration: 'none', fontWeight: 600 }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

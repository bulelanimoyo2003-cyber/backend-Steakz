import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';

interface Branch {
  id: number;
  name: string;
  address: string;
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Branch[]>('/public/branches')
      .then((response) => setBranches(response.data))
      .catch(() => setError('Unable to load branch locations.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <div className="page-header">
        <h1>Locations</h1>
        <p>Browse our active Steakz locations and access each menu.</p>
      </div>

      {loading ? (
        <div className="empty-state">
          <span>⏳</span>
          Loading branch locations…
        </div>
      ) : error ? (
        <div className="alert alert-error">⚠ {error}</div>
      ) : (
        <div className="card-grid">
          {branches.map((branch) => (
            <div className="card" key={branch.id}>
              <span className="card-label">Steakz</span>
              <h3 style={{ fontFamily: 'Playfair Display, serif', marginBottom: '0.75rem' }}>{branch.name}</h3>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>{branch.address}</p>
              <Link to="/menu" className="btn btn-outline" style={{ marginTop: 'auto' }}>
                View Menu
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

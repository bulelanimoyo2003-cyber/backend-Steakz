import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/axios';

interface Branch {
  id: number;
  name: string;
}

export default function LandingPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<Branch[]>('/public/branches')
      .then((response) => setBranches(response.data))
      .catch(() => setError('Unable to load active locations.'));
  }, []);

  return (
    <div>
      <div className="hero">
        <div className="ornament">Est. 2024</div>
        <h1>Steakz</h1>
        <p>
          Premium cuts, masterfully prepared — reserve your table and experience the difference.
        </p>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <Link to="/menu" className="btn btn-primary">
            Explore Menu
          </Link>
          <Link to="/register" className="btn btn-outline">
            Reserve a Table
          </Link>
        </div>
      </div>

      <div className="page" style={{ paddingTop: '1rem' }}>
        <div className="section-title">Our Locations</div>
        {error && <div className="alert alert-error">⚠ {error}</div>}
        <div className="card-grid">
          {branches.map((branch) => (
            <div className="card" key={branch.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ color: 'var(--cognac)', fontSize: '1rem' }}>✦</span>
              <div>
                <span className="card-label">Steakz</span>
                <div style={{ fontFamily: 'Playfair Display, serif', fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                  {branch.name.replace('Steakz ', '')}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

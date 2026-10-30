import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ROLE_DASH: Record<string, string> = {
  ADMIN: '/admin',
  HQ_MANAGER: '/hq',
  BRANCH_MANAGER: '/branch-manager',
  CHEF: '/chef',
  CASHIER: '/cashier',
  DELIVERY_DRIVER: '/driver',
  CUSTOMER: '/customer',
};

export default function NavBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/');
  }

  return (
    <nav className="navbar">
      <NavLink to="/" className="navbar-brand">
        Steakz
      </NavLink>
      <div className="nav-links">
        <NavLink to="/menu" className={({isActive}) => isActive ? 'active-link' : ''}>
          <span className="nav-link-icon">🍽️</span> Menu
        </NavLink>
        <NavLink to="/branches" className={({isActive}) => isActive ? 'active-link' : ''}>
          <span className="nav-link-icon">📍</span> Branches
        </NavLink>
        {user ? (
          <>
            <NavLink to={ROLE_DASH[user.role] ?? '/'} className={({isActive}) => isActive ? 'active-link' : ''}>
              <span className="nav-link-icon">📊</span> Dashboard
            </NavLink>
            {user.role === 'CUSTOMER' && <NavLink to="/book" className={({isActive}) => isActive ? 'active-link' : ''}><span className="nav-link-icon">🪑</span> Reserve</NavLink>}
            <span className="nav-badge">{user.role.replace(/_/g, ' ')}</span>
            <button className="btn btn-outline btn-sm" onClick={handleLogout} type="button">
              Sign Out
            </button>
          </>
        ) : (
          <>
            <NavLink to="/login" className={({isActive}) => isActive ? 'active-link' : ''}>Sign In</NavLink>
            <NavLink to="/register" className="btn btn-primary btn-sm">
              Reserve a Table
            </NavLink>
          </>
        )}
      </div>
    </nav>
  );
}

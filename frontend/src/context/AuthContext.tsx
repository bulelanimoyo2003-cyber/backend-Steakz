import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

interface AuthUser {
  id: number;
  name: string;
  role: string;
  branchId: number | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const storedToken = localStorage.getItem('steakz_token');
    const storedUser = localStorage.getItem('steakz_user');

    const clearAuth = () => {
      localStorage.removeItem('steakz_token');
      localStorage.removeItem('steakz_user');
      setToken(null);
      setUser(null);
      if (location.pathname !== '/login') {
        navigate('/login', { replace: true });
      }
    };

    if (!storedToken || !storedUser || storedUser === 'undefined') {
      clearAuth();
      return;
    }

    try {
      const parsedUser = JSON.parse(storedUser) as AuthUser;
      if (
        !parsedUser ||
        typeof parsedUser !== 'object' ||
        typeof parsedUser.id !== 'number' ||
        typeof parsedUser.name !== 'string' ||
        typeof parsedUser.role !== 'string' ||
        (typeof parsedUser.branchId !== 'number' && parsedUser.branchId !== null)
      ) {
        throw new Error('Invalid stored user.');
      }

      setToken(storedToken);
      setUser(parsedUser);
    } catch {
      clearAuth();
    }
  }, [location.pathname, navigate]);

  function login(t: string, u: AuthUser) {
    localStorage.setItem('steakz_token', t);
    localStorage.setItem('steakz_user', JSON.stringify(u));
    setToken(t);
    setUser(u);
  }

  function logout() {
    localStorage.removeItem('steakz_token');
    localStorage.removeItem('steakz_user');
    setToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, token, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: string;
  branchId: number | null;
}

function safeParseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function getStoredAuth(): { token: string | null; user: AuthUser | null } {
  if (typeof window === 'undefined') {
    return { token: null, user: null };
  }

  const storedToken = localStorage.getItem('steakz_token');
  const storedUser = localStorage.getItem('steakz_user');

  if (!storedToken || !storedUser || storedUser === 'undefined') {
    localStorage.removeItem('steakz_token');
    localStorage.removeItem('steakz_user');
    return { token: null, user: null };
  }

  const parsedUser = safeParseJson<AuthUser>(storedUser);
  if (
    !parsedUser ||
    typeof parsedUser !== 'object' ||
    typeof parsedUser.id !== 'number' ||
    typeof parsedUser.name !== 'string' ||
    typeof parsedUser.email !== 'string' ||
    typeof parsedUser.role !== 'string' ||
    (typeof parsedUser.branchId !== 'number' && parsedUser.branchId !== null)
  ) {
    localStorage.removeItem('steakz_token');
    localStorage.removeItem('steakz_user');
    return { token: null, user: null };
  }

  return { token: storedToken, user: parsedUser };
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (token: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({} as AuthContextType);

export function AuthProvider({ children }: { children: ReactNode }) {
  const initialAuth = getStoredAuth();
  const [user, setUser] = useState<AuthUser | null>(initialAuth.user);
  const [token, setToken] = useState<string | null>(initialAuth.token);

  useEffect(() => {
    function handleSessionExpired() {
      localStorage.removeItem('steakz_token');
      localStorage.removeItem('steakz_user');
      sessionStorage.removeItem('steakz-checkout-idempotency');
      setToken(null);
      setUser(null);
    }

    window.addEventListener('steakz:session-expired', handleSessionExpired);
    return () => window.removeEventListener('steakz:session-expired', handleSessionExpired);
  }, []);

  function login(t: string, u: AuthUser) {
    const previousUser = safeParseJson<AuthUser>(localStorage.getItem('steakz_user'));
    if (previousUser?.id !== u.id) sessionStorage.removeItem('steakz-checkout-idempotency');
    localStorage.setItem('steakz_token', t);
    localStorage.setItem('steakz_user', JSON.stringify(u));
    setToken(t);
    setUser(u);
  }

  function logout() {
    localStorage.removeItem('steakz_token');
    localStorage.removeItem('steakz_user');
    sessionStorage.removeItem('steakz-checkout-idempotency');
    setToken(null);
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, token, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

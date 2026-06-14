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

  useEffect(() => {
    const storedToken = localStorage.getItem('steakz_token');
    const storedUser = localStorage.getItem('steakz_user');

    const clearAuth = () => {
      localStorage.removeItem('steakz_token');
      localStorage.removeItem('steakz_user');
      setToken(null);
      setUser(null);
    };

    if (!storedToken || !storedUser || storedUser === 'undefined') {
      clearAuth();
      return;
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
      clearAuth();
      return;
    }

    setToken(storedToken);
    setUser(parsedUser);
  }, []);

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

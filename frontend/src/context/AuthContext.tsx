import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

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

  useEffect(() => {
    const storedToken = localStorage.getItem('steakz_token');
    const storedUser = localStorage.getItem('steakz_user');
    if (
      storedToken &&
      storedUser &&
      storedUser !== 'undefined'
    ) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser) as AuthUser);
    } else {
      localStorage.removeItem('steakz_token');
      localStorage.removeItem('steakz_user');
      setToken(null);
      setUser(null);   
    }
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

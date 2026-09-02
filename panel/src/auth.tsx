import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';

interface Admin { id: string; email: string; role: 'admin' | 'viewer'; }
interface AuthCtx {
  admin: Admin | null;
  ready: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  canWrite: boolean;
}

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api.get<{ admin: Admin }>('/api/auth/me')
      .then((r) => setAdmin(r.admin))
      .catch(() => setToken(''))
      .finally(() => setReady(true));
  }, []);

  async function login(email: string, password: string) {
    const r = await api.post<{ token: string; admin: Admin }>('/api/auth/login', { email, password });
    setToken(r.token);
    setAdmin(r.admin);
  }

  function logout() {
    setToken('');
    setAdmin(null);
    location.assign('/login');
  }

  return (
    <Ctx.Provider value={{ admin, ready, login, logout, canWrite: admin?.role === 'admin' }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);

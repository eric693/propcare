import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import api, { CID_KEY, STAFF_TOKEN } from '../api/client';
import { Me } from '../types';

interface Ctx {
  user: Me | null;
  loading: boolean;
  /** 目前操作的社區 */
  cid: string;
  setCid: (id: string) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<Ctx>({} as Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [cid, setCidState] = useState(localStorage.getItem(CID_KEY) ?? '');

  const setCid = useCallback((id: string) => { localStorage.setItem(CID_KEY, id); setCidState(id); }, []);

  // 登入者的社區清單變動（或記住的社區已無權限）時，自動選第一個
  const adopt = useCallback((me: Me) => {
    setUser(me);
    const saved = localStorage.getItem(CID_KEY);
    if (!me.communities.some((c) => c.id === saved)) setCid(me.communities[0]?.id ?? '');
  }, [setCid]);

  const refresh = useCallback(async () => { adopt((await api.get('/auth/me')).data); }, [adopt]);

  useEffect(() => {
    if (!localStorage.getItem(STAFF_TOKEN)) { setLoading(false); return; }
    refresh().catch(() => localStorage.removeItem(STAFF_TOKEN)).finally(() => setLoading(false));
  }, [refresh]);

  async function login(username: string, password: string) {
    const r = await api.post('/auth/login', { username, password });
    localStorage.setItem(STAFF_TOKEN, r.data.token);
    adopt(r.data.user);
  }

  function logout() { localStorage.removeItem(STAFF_TOKEN); setUser(null); }

  return <AuthContext.Provider value={{ user, loading, cid, setCid, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
/** 委員帳號唯讀 */
export const useCanWrite = () => useAuth().user?.role !== 'COMMITTEE';

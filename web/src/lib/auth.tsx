import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, onUnauthorized, refreshSession, setAccessToken, type Session, type User } from './api.ts';
import { get } from './api.ts';

export interface Settings {
  gym_name: string; currency: string; locale: string; timezone: string; expiring_soon_days: number; reminder_days: number[];
  checkin_dedupe_minutes: number; checkin_allow_with_debt: boolean; cancel_min_hours: number; booking_window_days: number;
  freeze_min_days: number; renewal_grace_days: number; day_pass_price_cents: number; pass_ttl_seconds: number;
}
export interface Branch { id: number; name: string; address: string; opens_at: string; closes_at: string; capacity: number; active: number }

interface AuthState {
  user: User | null;
  ready: boolean;
  settings: Settings | null;
  branches: Branch[];
  branchId: number | null;
  setBranchId: (id: number) => void;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  reloadSettings: () => Promise<void>;
  reloadBranches: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchIdState] = useState<number | null>(null);

  const loadContext = useCallback(async (u: User) => {
    const [s, b] = await Promise.all([get<Settings>('/settings'), get<Branch[]>('/branches')]);
    setSettings(s);
    setBranches(b);
    let saved: number | null = null;
    try { saved = Number(localStorage.getItem('gymos-branch')) || null; } catch { /* sin almacenamiento */ }
    const active = b.filter((x) => x.active);
    setBranchIdState(active.find((x) => x.id === saved)?.id ?? u.branchId ?? active[0]?.id ?? null);
  }, []);

  const start = useCallback(async (s: Session) => {
    setAccessToken(s.accessToken);
    await loadContext(s.user);
    setUser(s.user);
    return s.user;
  }, [loadContext]);

  useEffect(() => {
    onUnauthorized(() => setUser(null));
    refreshSession().then(async (s) => { if (s) await start(s).catch(() => setUser(null)); }).finally(() => setReady(true));
  }, [start]);

  // Renovación proactiva un minuto antes de que expire el access token (15 min).
  useEffect(() => {
    if (!user) return;
    const id = setInterval(() => { refreshSession().then((s) => { if (!s) setUser(null); }); }, 13 * 60_000);
    return () => clearInterval(id);
  }, [user]);

  const value = useMemo<AuthState>(() => ({
    user, ready, settings, branches, branchId,
    setBranchId: (id) => { setBranchIdState(id); try { localStorage.setItem('gymos-branch', String(id)); } catch { /* */ } },
    login: async (email, password) => start(await api<Session>('POST', '/auth/login', { email, password })),
    logout: async () => {
      await api('POST', '/auth/logout').catch(() => undefined);
      setAccessToken(null);
      setUser(null);
    },
    reloadSettings: async () => setSettings(await get<Settings>('/settings')),
    reloadBranches: async () => setBranches(await get<Branch[]>('/branches')),
  }), [user, ready, settings, branches, branchId, start]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}

/** Solo para pantallas autenticadas. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('Sin sesión');
  return user;
}

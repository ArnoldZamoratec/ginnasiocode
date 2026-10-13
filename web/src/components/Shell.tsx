import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { useAuth, useUser } from '../lib/auth.tsx';
import { ROLE } from '../lib/format.ts';
import { Icon } from './ui.tsx';
import { useApi } from '../lib/hooks.ts';

export interface NavItem { to: string; label: string; icon: string; group?: string; end?: boolean }

const NAV: Record<string, NavItem[]> = {
  reception: [
    { to: '/recepcion', label: 'Check-in', icon: 'scan' },
    { to: '/socios', label: 'Socios', icon: 'users' },
    { to: '/clases', label: 'Clases', icon: 'calendar' },
    { to: '/caja', label: 'Caja', icon: 'cash' },
  ],
  trainer: [
    { to: '/entrenador', label: 'Mis socios', icon: 'users' },
    { to: '/rutinas', label: 'Rutinas', icon: 'clipboard' },
    { to: '/ejercicios', label: 'Ejercicios', icon: 'dumbbell' },
    { to: '/clases', label: 'Clases', icon: 'calendar' },
  ],
  admin: [
    { to: '/panel', label: 'Panel', icon: 'chart' },
    { to: '/recepcion', label: 'Check-in', icon: 'scan' },
    { to: '/socios', label: 'Socios', icon: 'users' },
    { to: '/clases', label: 'Clases', icon: 'calendar' },
    { to: '/caja', label: 'Caja', icon: 'cash' },
    { to: '/rutinas', label: 'Rutinas', icon: 'clipboard', group: 'Entrenamiento' },
    { to: '/ejercicios', label: 'Ejercicios', icon: 'dumbbell', group: 'Entrenamiento' },
    { to: '/admin/planes', label: 'Planes y precios', icon: 'card', group: 'Configuración' },
    { to: '/admin/horario', label: 'Horario de clases', icon: 'calendar', group: 'Configuración' },
    { to: '/admin/sedes', label: 'Sedes', icon: 'home', group: 'Configuración' },
    { to: '/admin/personal', label: 'Personal', icon: 'user', group: 'Configuración' },
    { to: '/admin/avisos', label: 'Avisos', icon: 'bell', group: 'Configuración' },
    { to: '/admin/ajustes', label: 'Ajustes', icon: 'settings', group: 'Configuración' },
    { to: '/admin/auditoria', label: 'Auditoría', icon: 'shield', group: 'Configuración' },
  ],
};

export function homeFor(role: string): string {
  return { member: '/', reception: '/recepcion', trainer: '/entrenador', admin: '/panel' }[role] ?? '/';
}

export function ThemeToggle({ label }: { label?: boolean }) {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'dark');
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button className="btn ghost sm" onClick={() => {
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem('gymos-theme', next); } catch { /* */ }
      setTheme(next);
    }} aria-label={`Cambiar a modo ${next === 'dark' ? 'oscuro' : 'claro'}`}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />{label && (next === 'dark' ? 'Modo oscuro' : 'Modo claro')}
    </button>
  );
}

function Brand({ to }: { to: string }) {
  const { settings } = useAuth();
  return (
    <Link to={to} className="brand" aria-label="Inicio">
      <b>{(settings?.gym_name ?? 'GymOS').toUpperCase()}</b><i aria-hidden />
    </Link>
  );
}

export function BranchPicker() {
  const { branches, branchId, setBranchId } = useAuth();
  const active = branches.filter((b) => b.active);
  if (active.length < 2) return null;
  return (
    <select className="select" style={{ minHeight: 34, padding: '4px 8px', fontSize: 13 }} value={branchId ?? ''} onChange={(e) => setBranchId(Number(e.target.value))} aria-label="Sede">
      {active.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
}

export function StaffShell() {
  const user = useUser();
  const { logout } = useAuth();
  const items = NAV[user.role] ?? [];
  const [more, setMore] = useState(false);
  let lastGroup: string | undefined;
  const mobile = items.length > 5 ? [...items.slice(0, 4)] : items;
  return (
    <div className="shell">
      <aside className="rail">
        <Brand to={homeFor(user.role)} />
        <nav className="nav" aria-label="Principal">
          {items.map((i, n) => {
            const head = i.group && i.group !== lastGroup ? <div className="nav-group eyebrow">{i.group}</div> : null;
            lastGroup = i.group;
            return (
              <div key={i.to} style={{ display: 'contents' }}>
                {head}
                <NavLink to={i.to} end={i.end} title={i.label}>
                  <Icon name={i.icon} /><span className="l">{i.label}</span>{!i.group && <span className="k">{String(n + 1).padStart(2, '0')}</span>}
                </NavLink>
              </div>
            );
          })}
        </nav>
        <div className="rail-foot">
          <BranchPicker />
          <div className="who"><b>{user.name}</b><span>{ROLE[user.role]}</span></div>
          <div className="row">
            <ThemeToggle />
            <button className="btn ghost sm" onClick={logout} title="Cerrar sesión" aria-label="Cerrar sesión"><Icon name="logout" size={16} /></button>
          </div>
        </div>
      </aside>
      <div className="main">
        <div className="topbar-mobile">
          <Brand to={homeFor(user.role)} />
          <div className="grow" />
          <BranchPicker />
          <ThemeToggle />
          <button className="btn ghost sm" onClick={logout} aria-label="Cerrar sesión"><Icon name="logout" size={16} /></button>
        </div>
        <Outlet />
      </div>
      <nav className="bottomnav only-sm" aria-label="Principal" style={{ gridTemplateColumns: `repeat(${mobile.length + (items.length > 5 ? 1 : 0)}, 1fr)` }}>
        {mobile.map((i) => <NavLink key={i.to} to={i.to}><Icon name={i.icon} />{i.label.split(' ')[0]}</NavLink>)}
        {items.length > 5 && (
          <a href="#mas" onClick={(e) => { e.preventDefault(); setMore((v) => !v); }} className={more ? 'active' : ''}><Icon name="more" />Más</a>
        )}
      </nav>
      {more && (
        <div className="only-sm" style={{ position: 'fixed', inset: 'auto 0 calc(62px + env(safe-area-inset-bottom)) 0', zIndex: 19, background: 'var(--bg)', borderTop: '2px solid var(--fg)', maxHeight: '60vh', overflowY: 'auto' }}>
          <nav className="nav" onClick={() => setMore(false)}>
            {items.slice(4).map((i) => <NavLink key={i.to} to={i.to}><Icon name={i.icon} /><span>{i.label}</span><span /></NavLink>)}
          </nav>
        </div>
      )}
    </div>
  );
}

export function MemberShell() {
  const unread = useApi<{ unread: number }>('/me/notifications');
  const tabs: (NavItem & { pass?: boolean; badge?: boolean })[] = [
    { to: '/', label: 'Inicio', icon: 'home', end: true },
    { to: '/clases', label: 'Clases', icon: 'calendar' },
    { to: '/pase', label: 'Ingreso', icon: 'qr', pass: true },
    { to: '/entreno', label: 'Entreno', icon: 'dumbbell' },
    { to: '/cuenta', label: 'Cuenta', icon: 'user', badge: (unread.data?.unread ?? 0) > 0 },
  ];
  return (
    <div className="m-shell">
      <Outlet context={{ refreshUnread: unread.reload }} />
      <nav className="bottomnav" aria-label="Principal">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={t.pass ? 'pass' : undefined}>
            {t.pass ? <span className="box"><Icon name={t.icon} size={24} /></span> : <Icon name={t.icon} />}
            <span style={t.pass ? { color: 'var(--fg-2)' } : undefined}>{t.label}</span>
            {t.badge && <i className="dot" aria-label="Avisos sin leer" />}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function MemberTop({ title, right }: { title?: ReactNode; right?: ReactNode }) {
  return (
    <header className="m-top">
      <Brand to="/" />
      {title && <span className="eyebrow">{title}</span>}
      <div className="grow" />
      {right}
    </header>
  );
}

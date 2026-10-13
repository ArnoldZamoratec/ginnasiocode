import { createContext, useCallback, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { ApiError } from '../lib/api.ts';
import { STATE, type MembershipState } from '../lib/format.ts';

// ---------------------------------------------------------------- layout

export function PageHead({ eyebrow, title, actions }: { eyebrow?: ReactNode; title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Section({ idx, title, aside, children, className }: { idx?: string; title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`section ${className ?? ''}`}>
      <div className="section-head">
        {idx && <span className="idx">{idx}</span>}
        <h2>{title}</h2>
        {aside && <div className="aside">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Kpi({ label, value, unit, detail, hero }: { label: string; value: ReactNode; unit?: string; detail?: ReactNode; hero?: boolean }) {
  return (
    <div className={`kpi ${hero ? 'hero' : ''}`}>
      <span className="eyebrow">{label}</span>
      <div className="v">{value}{unit && <small>{unit}</small>}</div>
      {detail && <div className="d">{detail}</div>}
    </div>
  );
}

// --------------------------------------------------------------- controls

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost'; size?: 'sm' | 'lg'; busy?: boolean; block?: boolean };
export function Button({ variant, size, busy, block, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button {...rest} disabled={disabled || busy} aria-busy={busy || undefined}
      className={['btn', variant, size, block && 'block', className].filter(Boolean).join(' ')}>
      {busy && <span className="spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span>{label}</span>
      {children}
      {error ? <small className="err" role="alert">{error}</small> : hint ? <small className="hint">{hint}</small> : null}
    </label>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function StateTag({ state }: { state: MembershipState }) {
  const s = STATE[state] ?? STATE.none;
  return <span className={`tag ${s.tone}`}>{s.label}</span>;
}

export function Tag({ tone = 'mute', children }: { tone?: 'ok' | 'warn' | 'bad' | 'mute' | 'info'; children: ReactNode }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}

export function Meter({ value, max, tone }: { value: number; max: number; tone?: 'ok' | 'warn' | 'bad' }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <div className={`meter ${tone ?? ''}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}><i style={{ width: `${pct}%` }} /></div>;
}

// ---------------------------------------------------------- estados vacíos

export function Empty({ glyph = '∅', title, children, action }: { glyph?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="glyph" aria-hidden>{glyph}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: ApiError; retry?: () => void }) {
  const title = error.status === 403 ? 'Sin acceso' : error.status === 404 ? 'No encontrado' : error.code === 'NETWORK' ? 'Sin conexión' : 'Algo falló';
  return (
    <div className="errorbox" role="alert">
      <b>{title}</b>
      <p>{error.message}</p>
      {retry && error.status !== 403 && error.status !== 404 && <Button size="sm" onClick={retry}>Reintentar</Button>}
    </div>
  );
}

export function Skeleton({ lines = 4, block }: { lines?: number; block?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Cargando">
      {block && <div className="skel skel-block" />}
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skel skel-line" style={{ width: `${92 - ((i * 23) % 40)}%` }} />)}
    </div>
  );
}

/** Patrón de carga estándar: error > esqueleto > contenido. */
export function Load<T>({ q, children, skeleton }: { q: { data: T | undefined; error: ApiError | null; loading: boolean; reload: () => void }; children: (d: T) => ReactNode; skeleton?: ReactNode }) {
  if (q.error && q.data === undefined) return <ErrorState error={q.error} retry={q.reload} />;
  if (q.data === undefined) return <>{skeleton ?? <Skeleton />}</>;
  return <>{children(q.data)}</>;
}

// ----------------------------------------------------------------- diálogos

export function Sheet({ open, onClose, title, eyebrow, children, footer, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; eyebrow?: string; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`sheet ${wide ? 'wide' : ''}`} onClose={onClose} onCancel={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <>
          <div className="sheet-head">
            <div className="grow">
              {eyebrow && <span className="eyebrow">{eyebrow}</span>}
              <h2>{title}</h2>
            </div>
            <button className="btn ghost sm" onClick={onClose} aria-label="Cerrar">✕</button>
          </div>
          <div className="sheet-body">{children}</div>
          {footer && <div className="sheet-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function FormError({ error }: { error: ApiError | null }) {
  if (!error) return null;
  const fields = Object.entries(error.fields);
  return (
    <div className="notice bad" role="alert">
      {error.message}
      {fields.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{fields.map(([k, v]) => <li key={k}>{v}</li>)}</ul>}
    </div>
  );
}

// ------------------------------------------------------------------ toasts

interface ToastItem { id: number; text: string; tone?: 'bad' }
const ToastCtx = createContext<(text: string, tone?: 'bad') => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback((text: string, tone?: 'bad') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x.slice(-2), { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.tone ?? ''}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ------------------------------------------------------------------- iconos
// Trazos rectos de 1.75 px, sin rellenos: coherentes con la grilla.
const P: Record<string, ReactNode> = {
  home: <path d="M3 11 12 4l9 7v9h-6v-6H9v6H3z" />,
  qr: <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2v2h-2zM18 14h2v2h-2z" /></>,
  scan: <><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><path d="M4 12h16" /></>,
  calendar: <><path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" /></>,
  dumbbell: <><path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12" /></>,
  card: <><path d="M3 6h18v12H3zM3 10h18M7 15h4" /></>,
  bell: <><path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4" /></>,
  users: <><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a7 7 0 0 1 14 0v1M16 3.5a4 4 0 0 1 0 7M18 14a7 7 0 0 1 4 6v1" /></>,
  chart: <><path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-8M20 16v-3" /></>,
  cash: <><path d="M3 7h18v10H3z" /><path d="M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 10v4M18 10v4" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1" /></>,
  settings: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><path d="M14 4v4M8 10v4M16 16v4" /></>,
  shield: <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />,
  user: <><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM4 21a8 8 0 0 1 16 0" /></>,
  logout: <><path d="M14 4h6v16h-6M10 8l-4 4 4 4M6 12h11" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>,
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M4 20h16" />,
  clipboard: <><path d="M8 4h8v3H8zM6 5H4v16h16V5h-2" /><path d="M8 12h8M8 16h5" /></>,
  more: <path d="M4 7h16M4 12h16M4 17h16" />,
};
export function Icon({ name, size = 20 }: { name: keyof typeof P | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="square" strokeLinejoin="miter" aria-hidden>
      {P[name]}
    </svg>
  );
}

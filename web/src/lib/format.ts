// Formatos para Perú (configurable en Ajustes: moneda, locale, zona horaria).
let LOCALE = 'es-PE';
let CURRENCY = 'PEN';
let TZ = 'America/Lima';

export function configureFormat(s: { locale: string; currency: string; timezone: string }) {
  LOCALE = s.locale; CURRENCY = s.currency; TZ = s.timezone;
}

export function money(cents: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (cents == null) return '—';
  if (opts.compact && Math.abs(cents) >= 1_000_000) {
    return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, notation: 'compact', maximumFractionDigits: 1 }).format(cents / 100);
  }
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY }).format(cents / 100);
}

/** Separa símbolo y cifra para tratar los números como protagonistas. */
export function moneyParts(cents: number): { symbol: string; value: string } {
  const parts = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY, maximumFractionDigits: 0 }).formatToParts(cents / 100);
  return {
    symbol: parts.find((p) => p.type === 'currency')?.value ?? '',
    value: parts.filter((p) => !['currency', 'literal'].includes(p.type)).map((p) => p.value).join(''),
  };
}

/** YYYY-MM-DD → 14/03/2026 */
export function date(d: string | null | undefined): string {
  if (!d) return '—';
  const s = d.length > 10 ? localDate(d) : d;
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
}

const DOW = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DOW_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
export const WEEKDAYS_MON = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export function dayName(d: string, short = false): string {
  const wd = new Date(d.slice(0, 10) + 'T12:00:00Z').getUTCDay();
  return (short ? DOW_SHORT : DOW)[wd];
}
/** "lunes 14 de marzo" */
export function longDate(d: string): string {
  const s = d.length > 10 ? localDate(d) : d;
  return `${dayName(s).toLowerCase()} ${Number(s.slice(8, 10))} de ${MONTHS[Number(s.slice(5, 7)) - 1]}`;
}
export function shortDate(d: string): string {
  const s = d.length > 10 ? localDate(d) : d;
  return `${Number(s.slice(8, 10))} ${MONTHS_SHORT[Number(s.slice(5, 7)) - 1]}`;
}
export function monthName(ym: string, short = false): string {
  const m = MONTHS[Number(ym.slice(5, 7)) - 1];
  return short ? m.slice(0, 3) : m;
}

/** ISO → HH:MM en la zona del gimnasio */
export function time(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-PE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
}
/** ISO → YYYY-MM-DD en la zona del gimnasio */
export function localDate(iso: string | Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return p;
}
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${date(localDate(iso))} ${time(iso)}`;
}
export function today(): string { return localDate(new Date()); }

export function addDays(d: string, n: number): string {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000);
}
/** Lunes de la semana de `d` */
export function weekStart(d: string): string {
  const wd = new Date(d + 'T12:00:00Z').getUTCDay() || 7;
  return addDays(d, 1 - wd);
}

/** "hace 3 días", "ayer", "hoy 18:20" */
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'Nunca';
  const d = localDate(iso);
  const n = diffDays(d, today());
  if (n <= 0) return `Hoy ${time(iso)}`;
  if (n === 1) return 'Ayer';
  if (n < 30) return `Hace ${n} días`;
  if (n < 60) return 'Hace 1 mes';
  return `Hace ${Math.floor(n / 30)} meses`;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export type MembershipState = 'none' | 'not_started' | 'active' | 'expiring' | 'expires_today' | 'expired' | 'frozen' | 'replaced' | 'cancelled';

export const STATE: Record<MembershipState, { label: string; tone: 'ok' | 'warn' | 'bad' | 'mute' | 'info' }> = {
  active: { label: 'Activo', tone: 'ok' },
  expiring: { label: 'Por vencer', tone: 'warn' },
  expires_today: { label: 'Vence hoy', tone: 'warn' },
  expired: { label: 'Vencido', tone: 'bad' },
  frozen: { label: 'Congelado', tone: 'info' },
  not_started: { label: 'Aún no inicia', tone: 'info' },
  none: { label: 'Sin plan', tone: 'mute' },
  replaced: { label: 'Reemplazado', tone: 'mute' },
  cancelled: { label: 'Anulado', tone: 'mute' },
};

export const METHOD: Record<string, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' };
export const ROLE: Record<string, string> = { member: 'Socio', reception: 'Recepción', trainer: 'Entrenador', admin: 'Administración' };
export const MUSCLE: Record<string, string> = {
  pecho: 'Pecho', espalda: 'Espalda', piernas: 'Piernas', gluteos: 'Glúteos', hombros: 'Hombros', biceps: 'Bíceps',
  triceps: 'Tríceps', core: 'Core', cardio: 'Cardio', cuerpo_completo: 'Cuerpo completo',
};
export const DENY: Record<string, string> = {
  NO_MEMBERSHIP: 'Sin plan', NOT_STARTED: 'Plan aún no inicia', EXPIRED: 'Plan vencido', FROZEN: 'Plan congelado',
  DEBT: 'Deuda pendiente', PASS_EXPIRED: 'QR expirado',
};

export function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase();
}

export function kg(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${Number.isInteger(n) ? n : n.toFixed(1)} kg`;
}

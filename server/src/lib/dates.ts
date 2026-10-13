/**
 * Utilidades de fecha. Convenciones:
 *  - Fechas de calendario ("2026-10-12") se expresan en la zona horaria del gimnasio.
 *  - Instantes se guardan como ISO-8601 UTC.
 */
const DAY = 86_400_000;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export interface LocalParts { date: string; hour: number; minute: number; weekday: number }
const WD: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localParts(instant: Date | string, tz: string): LocalParts {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  const p = Object.fromEntries(partsFmt(tz).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: WD[p.weekday] };
}

export function localDate(instant: Date | string, tz: string): string {
  return localParts(instant, tz).date;
}

function parseDate(d: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Fecha inválida: ${d}`);
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
}

export function addDays(date: string, n: number): string {
  return new Date(parseDate(date) + n * DAY).toISOString().slice(0, 10);
}

/** Días calendario de `a` a `b` (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((parseDate(b) - parseDate(a)) / DAY);
}

/** Días de un intervalo inclusivo [start, end]. */
export function spanDays(start: string, end: string): number {
  return diffDays(start, end) + 1;
}

export function weekdayOf(date: string): number {
  const wd = new Date(parseDate(date)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function startOfWeek(date: string): string {
  return addDays(date, 1 - weekdayOf(date));
}

export function monthBounds(month: string): { start: string; end: string } {
  const start = `${month}-01`;
  const next = new Date(parseDate(start));
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { start, end: addDays(next.toISOString().slice(0, 10), -1) };
}

export function addMonths(month: string, n: number): string {
  const d = new Date(parseDate(`${month}-01`));
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

/** Convierte fecha + hora local del gimnasio a instante UTC (maneja cualquier offset/DST). */
export function localToUtc(date: string, time: string, tz: string): Date {
  const [h, m] = time.split(':').map(Number);
  const guess = parseDate(date) + (h * 60 + m) * 60_000;
  // offset = hora local que muestra la zona para `guess` menos `guess`
  const p = localParts(new Date(guess), tz);
  const shown = parseDate(p.date) + (p.hour * 60 + p.minute) * 60_000;
  const offset = shown - guess;
  const result = new Date(guess - offset);
  const check = localParts(result, tz);
  if (check.hour !== h) {
    const p2 = localParts(result, tz);
    const shown2 = parseDate(p2.date) + (p2.hour * 60 + p2.minute) * 60_000;
    return new Date(guess - (shown2 - result.getTime()));
  }
  return result;
}

/** Inicio (UTC) del día local y del día siguiente, para filtrar instantes por fecha local. */
export function localDayRangeUtc(date: string, tz: string): { from: string; to: string } {
  return {
    from: localToUtc(date, '00:00', tz).toISOString(),
    to: localToUtc(addDays(date, 1), '00:00', tz).toISOString(),
  };
}

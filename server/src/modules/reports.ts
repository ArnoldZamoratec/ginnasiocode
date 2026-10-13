import { z } from 'zod';
import { all, one } from '../db/db.ts';
import { route, isoDate } from '../lib/http.ts';
import { AppError } from '../lib/errors.ts';
import { clock } from '../lib/clock.ts';
import { getSettings } from '../lib/settings.ts';
import { addDays, addMonths, diffDays, localDayRangeUtc, localParts, monthBounds } from '../lib/dates.ts';
import { todayLocal } from './memberships.ts';
import { memberDebt } from './payments.ts';

interface Span { member_id: number; start_date: string; end_date: string; plan_id: number; plan_name: string; amount_due_cents: number; price_cents: number; id: number; phone: string | null; full_name: string }

function coverageSpans(): Span[] {
  return all<Span>(
    `SELECT ms.id, ms.member_id, ms.start_date, ms.end_date, ms.plan_id, p.name plan_name, ms.amount_due_cents, p.price_cents,
       m.phone, m.first_name || ' ' || m.last_name full_name
     FROM memberships ms JOIN plans p ON p.id = ms.plan_id JOIN members m ON m.id = ms.member_id
     WHERE ms.status <> 'cancelled' ORDER BY ms.member_id, ms.start_date`,
  );
}

/**
 * Último día cubierto del socio considerando solo membresías que empezaron hasta `horizon`.
 * Si renovó dentro del periodo de gracia, su cobertura continúa y no cuenta como baja.
 */
function coverageEnd(spans: Span[], memberId: number, horizon: string): string | null {
  let end: string | null = null;
  for (const s of spans) if (s.member_id === memberId && s.start_date <= horizon && (!end || s.end_date > end)) end = s.end_date;
  return end;
}

/** Tasa histórica de renovación (últimos 6 meses cerrados) usada en proyecciones. */
function renewalRate(spans: Span[], today: string, grace: number): number {
  const from = addDays(today, -180), to = addDays(today, -grace - 1);
  const ending = spans.filter((s) => s.end_date >= from && s.end_date <= to);
  if (!ending.length) return 0.6;
  const renewed = ending.filter((s) => (coverageEnd(spans, s.member_id, addDays(s.end_date, grace)) ?? '') > s.end_date);
  return renewed.length / ending.length;
}

export const reportRoutes = [
  route({
    method: 'get', path: '/reports/overview', tag: 'Reportes', summary: 'Indicadores principales', auth: ['admin'],
    handler: () => {
      const s = getSettings();
      const today = todayLocal();
      const spans = coverageSpans();
      const members = new Set(spans.map((x) => x.member_id));
      let active = 0, expiringSoon = 0;
      for (const id of members) {
        const cur = spans.filter((x) => x.member_id === id && x.start_date <= today && x.end_date >= today);
        if (cur.length) {
          active++;
          const end = coverageEnd(spans, id, addDays(today, 365))!;
          if (diffDays(today, end) <= s.expiring_soon_days) expiringSoon++;
        }
      }
      const tz = s.timezone;
      const month = today.slice(0, 7);
      const mtdFrom = localDayRangeUtc(`${month}-01`, tz).from;
      const nowIso = clock.now().toISOString();
      const prevMonth = addMonths(month, -1);
      const prevFrom = localDayRangeUtc(`${prevMonth}-01`, tz).from;
      const dayOfMonth = Number(today.slice(8, 10));
      const prevSameDay = addDays(`${prevMonth}-01`, Math.min(dayOfMonth, Number(monthBounds(prevMonth).end.slice(8, 10))));
      const prevTo = localDayRangeUtc(prevSameDay, tz).from;
      const revenue = (f: string, t: string) => one<{ s: number }>("SELECT IFNULL(SUM(amount_cents),0) s FROM payments WHERE status = 'valid' AND paid_at >= ? AND paid_at < ?", [f, t])!.s;
      const d30 = localDayRangeUtc(addDays(today, -29), tz).from;
      const visits30 = one<{ n: number }>("SELECT COUNT(*) n FROM visits WHERE result = 'granted' AND checked_in_at >= ?", [d30])!.n;
      const visitsToday = one<{ n: number }>("SELECT COUNT(*) n FROM visits WHERE result = 'granted' AND checked_in_at >= ?", [localDayRangeUtc(today, tz).from])!.n;
      const occ = one<{ booked: number; cap: number }>(
        `SELECT IFNULL(SUM((SELECT COUNT(*) FROM reservations r WHERE r.session_id = s.id AND r.status IN ('booked','attended','no_show'))),0) booked,
                IFNULL(SUM(s.capacity),0) cap
         FROM class_sessions s WHERE s.status = 'scheduled' AND s.starts_at >= ? AND s.starts_at < ?`, [d30, nowIso],
      )!;
      const debtors = all<{ id: number }>('SELECT DISTINCT member_id id FROM memberships');
      const debtTotal = debtors.reduce((sum, m) => sum + memberDebt(m.id).totalCents, 0);
      return {
        today,
        activeMembers: active,
        expiringSoon,
        revenueMtdCents: revenue(mtdFrom, nowIso),
        revenuePrevMtdCents: revenue(prevFrom, prevTo),
        visitsToday,
        avgVisitsPerDay: Math.round((visits30 / 30) * 10) / 10,
        classOccupancy30d: occ.cap ? Math.round((occ.booked / occ.cap) * 1000) / 10 : null,
        debtTotalCents: debtTotal,
        renewalRate: Math.round(renewalRate(spans, today, s.renewal_grace_days) * 1000) / 10,
      };
    },
  }),
  route({
    method: 'get', path: '/reports/heatmap', tag: 'Reportes', summary: 'Mapa de calor de ingresos (día × hora)', auth: ['admin', 'reception'],
    query: z.object({ from: isoDate.optional(), to: isoDate.optional(), branchId: z.coerce.number().int().positive().optional() }).strict(),
    handler: ({ query }) => {
      const tz = getSettings().timezone;
      const to = query.to ?? todayLocal();
      const from = query.from ?? addDays(to, -27);
      if (to < from) throw new AppError(422, 'INVALID_RANGE', 'Rango de fechas inválido.');
      const rows = all<{ checked_in_at: string }>(
        `SELECT checked_in_at FROM visits WHERE result = 'granted' AND checked_in_at >= :from AND checked_in_at < :to ${query.branchId ? 'AND branch_id = :branch' : ''}`,
        { from: localDayRangeUtc(from, tz).from, to: localDayRangeUtc(to, tz).to, branch: query.branchId },
      );
      const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
      for (const r of rows) { const p = localParts(r.checked_in_at, tz); grid[p.weekday - 1][p.hour]++; }
      // Promedio por día de la semana: divide por cuántas veces aparece ese día en el rango.
      const occurrences = Array<number>(7).fill(0);
      for (let d = from; d <= to; d = addDays(d, 1)) occurrences[(new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7]++;
      const avg = grid.map((row, i) => row.map((v) => (occurrences[i] ? Math.round((v / occurrences[i]) * 10) / 10 : 0)));
      const flat = avg.flatMap((row, wd) => row.map((v, h) => ({ wd: wd + 1, h, v })));
      const peak = flat.reduce((a, b) => (b.v > a.v ? b : a), flat[0]);
      return { from, to, total: rows.length, grid: avg, peak };
    },
  }),
  route({
    method: 'get', path: '/reports/occupancy', tag: 'Reportes', summary: 'Ocupación de clases por franja horaria', auth: ['admin'],
    query: z.object({ from: isoDate.optional(), to: isoDate.optional() }).strict(),
    handler: ({ query }) => {
      const tz = getSettings().timezone;
      const to = query.to ?? todayLocal();
      const from = query.from ?? addDays(to, -27);
      const sessions = all<{ id: number; starts_at: string; capacity: number; class_name: string; booked: number; attended: number; waitlisted: number }>(
        `SELECT s.id, s.starts_at, s.capacity, ct.name class_name,
           (SELECT COUNT(*) FROM reservations r WHERE r.session_id = s.id AND r.status IN ('booked','attended','no_show')) booked,
           (SELECT COUNT(*) FROM reservations r WHERE r.session_id = s.id AND r.status = 'attended') attended,
           (SELECT COUNT(*) FROM reservations r WHERE r.session_id = s.id AND (r.status = 'waitlist' OR r.promoted_at IS NOT NULL)) waitlisted
         FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id
         WHERE s.status = 'scheduled' AND s.starts_at >= ? AND s.starts_at < ?`,
        [localDayRangeUtc(from, tz).from, localDayRangeUtc(to, tz).to],
      );
      const SLOTS = [['Mañana temprano', 5, 9], ['Media mañana', 9, 12], ['Mediodía', 12, 15], ['Tarde', 15, 18], ['Noche', 18, 24]] as const;
      const bySlot = SLOTS.map(([label, a, b]) => {
        const ss = sessions.filter((s) => { const h = localParts(s.starts_at, tz).hour; return h >= a && h < b; });
        const cap = ss.reduce((x, s) => x + s.capacity, 0), booked = ss.reduce((x, s) => x + s.booked, 0);
        return { slot: label, fromHour: a, toHour: b, sessions: ss.length, capacity: cap, booked, occupancy: cap ? Math.round((booked / cap) * 1000) / 10 : null };
      });
      const types = [...new Set(sessions.map((s) => s.class_name))];
      const byClass = types.map((name) => {
        const ss = sessions.filter((s) => s.class_name === name);
        const cap = ss.reduce((x, s) => x + s.capacity, 0), booked = ss.reduce((x, s) => x + s.booked, 0), att = ss.reduce((x, s) => x + s.attended, 0);
        return {
          className: name, sessions: ss.length, occupancy: cap ? Math.round((booked / cap) * 1000) / 10 : null,
          attendance: booked ? Math.round((att / booked) * 1000) / 10 : null, fullSessions: ss.filter((s) => s.booked >= s.capacity).length,
          waitlisted: ss.reduce((x, s) => x + s.waitlisted, 0),
        };
      }).sort((a, b) => (b.occupancy ?? 0) - (a.occupancy ?? 0));
      return { from, to, bySlot, byClass };
    },
  }),
  route({
    method: 'get', path: '/reports/retention', tag: 'Reportes', summary: 'Socios que no renovaron', auth: ['admin', 'reception'],
    description: 'Membresías que vencieron en el mes sin una nueva dentro del periodo de gracia (`renewal_grace_days`).',
    query: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() }).strict(),
    handler: ({ query }) => {
      const s = getSettings();
      const today = todayLocal();
      const month = query.month ?? today.slice(0, 7);
      const { start, end } = monthBounds(month);
      const spans = coverageSpans();
      const ending = spans.filter((x) => x.end_date >= start && x.end_date <= end && x.end_date < today);
      const seen = new Set<number>();
      const lost: unknown[] = [];
      let renewed = 0;
      for (const x of ending) {
        if (seen.has(x.member_id)) continue;
        seen.add(x.member_id);
        const cover = coverageEnd(spans, x.member_id, addDays(x.end_date, s.renewal_grace_days))!;
        if (cover > x.end_date) { renewed++; continue; }
        const lastVisit = one<{ t: string | null }>("SELECT MAX(checked_in_at) t FROM visits WHERE member_id = ? AND result = 'granted'", [x.member_id])!.t;
        const daysSince = diffDays(x.end_date, today);
        lost.push({
          memberId: x.member_id, fullName: x.full_name, phone: x.phone, planName: x.plan_name, endDate: x.end_date,
          daysSinceExpiry: daysSince, lastVisit, withinGrace: daysSince <= s.renewal_grace_days,
        });
      }
      const total = renewed + lost.length;
      return { month, ending: total, renewed, notRenewed: lost.length, renewalRate: total ? Math.round((renewed / total) * 1000) / 10 : null, items: lost };
    },
  }),
  route({
    method: 'get', path: '/reports/revenue', tag: 'Reportes', summary: 'Ingresos proyectados vs. reales por mes', auth: ['admin'],
    description: 'Proyectado = valor de membresías que inician en el mes + (para meses en curso/futuros) renovaciones esperadas según la tasa histórica. Real = pagos válidos cobrados en el mes.',
    query: z.object({ months: z.coerce.number().int().min(2).max(24).default(6) }).strict(),
    handler: ({ query }) => {
      const s = getSettings();
      const tz = s.timezone;
      const today = todayLocal();
      const spans = coverageSpans();
      const rate = renewalRate(spans, today, s.renewal_grace_days);
      const current = today.slice(0, 7);
      const months = Array.from({ length: query.months }, (_, i) => addMonths(current, i - query.months + 2));
      const series = months.map((m) => {
        const { start, end } = monthBounds(m);
        const sold = spans.filter((x) => x.start_date >= start && x.start_date <= end).reduce((a, x) => a + x.amount_due_cents, 0);
        let expected = 0;
        if (end >= today) {
          // Vencen en el mes (desde hoy) y todavía no tienen renovación: se proyecta la renovación probable.
          for (const x of spans.filter((y) => y.end_date >= (start > today ? start : today) && y.end_date <= end)) {
            if ((coverageEnd(spans, x.member_id, addDays(end, 400)) ?? '') > x.end_date) continue;
            expected += Math.round(x.price_cents * rate);
          }
        }
        const real = one<{ s: number }>("SELECT IFNULL(SUM(amount_cents),0) s FROM payments WHERE status = 'valid' AND paid_at >= ? AND paid_at < ?",
          [localDayRangeUtc(start, tz).from, localDayRangeUtc(end, tz).to])!.s;
        return { month: m, projectedCents: sold + expected, soldCents: sold, expectedRenewalsCents: expected, realCents: real, closed: end < today };
      });
      return { renewalRate: Math.round(rate * 1000) / 10, series };
    },
  }),
  route({
    method: 'get', path: '/reports/churn', tag: 'Reportes', summary: 'Churn mensual', auth: ['admin'],
    description: 'Churn = socios activos al inicio del mes cuya cobertura terminó en el mes sin renovar dentro del periodo de gracia ÷ activos al inicio.',
    query: z.object({ months: z.coerce.number().int().min(2).max(24).default(6) }).strict(),
    handler: ({ query }) => {
      const s = getSettings();
      const today = todayLocal();
      const spans = coverageSpans();
      const current = today.slice(0, 7);
      const memberIds = [...new Set(spans.map((x) => x.member_id))];
      const series = Array.from({ length: query.months }, (_, i) => addMonths(current, i - query.months + 1)).map((m) => {
        const { start, end } = monthBounds(m);
        let activeAtStart = 0, churned = 0, pending = 0, newMembers = 0;
        for (const id of memberIds) {
          const mine = spans.filter((x) => x.member_id === id);
          if (mine[0].start_date >= start && mine[0].start_date <= end) newMembers++;
          if (!mine.some((x) => x.start_date <= start && x.end_date >= start)) continue;
          activeAtStart++;
          // Cobertura considerando renovaciones dentro de la gracia del fin de mes
          const cover = coverageEnd(spans, id, addDays(end, s.renewal_grace_days))!;
          if (cover >= start && cover <= end) {
            if (addDays(cover, s.renewal_grace_days) < today) churned++;
            else pending++;
          }
        }
        return { month: m, activeAtStart, newMembers, churned, atRisk: pending, churnRate: activeAtStart ? Math.round((churned / activeAtStart) * 1000) / 10 : null };
      });
      return { graceDays: s.renewal_grace_days, series };
    },
  }),
];

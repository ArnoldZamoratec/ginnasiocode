import { z } from 'zod';
import { all, insert, one, run, tx } from '../db/db.ts';
import { route, idParam, isoDate, money } from '../lib/http.ts';
import type { AuthUser } from '../lib/http.ts';
import { conflict, notFound, unprocessable } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { clock } from '../lib/clock.ts';
import { getSettings } from '../lib/settings.ts';
import { addDays, localDate, spanDays } from '../lib/dates.ts';
import { formatDate } from '../lib/format.ts';
import {
  balanceDue, checkFreeze, endDateFor, endFreezeEarly, membershipState, prorate, renewalStart,
  type StateResult,
} from '../domain/membership.ts';
import { assertMemberAccess } from './access-control.ts';
import { METHODS, paidCents, registerPayment, type PaymentRow } from './payments.ts';

export interface FreezeRow { id: number; membership_id: number; start_date: string; end_date: string; reason: string; ended_early_at: string | null; created_at: string }

export interface MembershipFull {
  id: number; member_id: number; plan_id: number; plan_name: string; includes_classes: number; max_freeze_days: number;
  duration_days: number; plan_active: number; plan_price_cents: number;
  start_date: string; end_date: string; status: 'active' | 'replaced' | 'cancelled';
  list_price_cents: number; credit_cents: number; amount_due_cents: number; replaces_id: number | null; created_at: string;
  freezes: FreezeRow[];
  paid_cents: number;
}

const BASE_SQL = `
  SELECT ms.*, p.name plan_name, p.includes_classes, p.max_freeze_days, p.duration_days, p.active plan_active, p.price_cents plan_price_cents,
    (SELECT IFNULL(SUM(amount_cents),0) FROM payments WHERE membership_id = ms.id AND status = 'valid') paid_cents
  FROM memberships ms JOIN plans p ON p.id = ms.plan_id`;

function withFreezes(rows: Omit<MembershipFull, 'freezes'>[]): MembershipFull[] {
  if (!rows.length) return [];
  const freezes = all<FreezeRow>(
    `SELECT * FROM membership_freezes WHERE membership_id IN (${rows.map(() => '?').join(',')}) ORDER BY start_date`,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({ ...r, freezes: freezes.filter((f) => f.membership_id === r.id) }));
}

export function loadMembership(id: number): MembershipFull | undefined {
  return withFreezes(all(`${BASE_SQL} WHERE ms.id = ?`, [id]))[0];
}

export function memberMemberships(memberId: number): MembershipFull[] {
  return withFreezes(all(`${BASE_SQL} WHERE ms.member_id = ? ORDER BY ms.start_date DESC, ms.id DESC`, [memberId]));
}

/** Membresía que define el estado del socio hoy: la vigente; si no, la próxima; si no, la última vencida. */
export function pickCurrent(list: MembershipFull[], today: string): MembershipFull | null {
  const active = list.filter((m) => m.status === 'active');
  const covering = active.filter((m) => m.start_date <= today && today <= m.end_date).sort((a, b) => b.start_date.localeCompare(a.start_date));
  if (covering[0]) return covering[0];
  const upcoming = active.filter((m) => m.start_date > today).sort((a, b) => a.start_date.localeCompare(b.start_date));
  if (upcoming[0]) return upcoming[0];
  return active.sort((a, b) => b.end_date.localeCompare(a.end_date))[0] ?? null;
}

export function currentMembership(memberId: number, today = todayLocal()): MembershipFull | null {
  return pickCurrent(memberMemberships(memberId), today);
}

export function todayLocal(): string {
  return localDate(clock.now(), getSettings().timezone);
}

export type MembershipView = ReturnType<typeof viewMembership>;
export function viewMembership(m: MembershipFull, today = todayLocal()) {
  const st: StateResult = membershipState(m, today, getSettings().expiring_soon_days);
  const usedFreezeDays = m.freezes.reduce((s, f) => s + spanDays(f.start_date, f.end_date), 0);
  return {
    id: m.id, memberId: m.member_id, planId: m.plan_id, planName: m.plan_name, includesClasses: !!m.includes_classes,
    startDate: m.start_date, endDate: m.end_date, status: m.status,
    state: m.status === 'active' ? st.state : m.status, daysLeft: st.daysLeft, frozenUntil: st.frozenUntil,
    totalDays: spanDays(m.start_date, m.end_date),
    listPriceCents: m.list_price_cents, creditCents: m.credit_cents, amountDueCents: m.amount_due_cents,
    paidCents: m.paid_cents, balanceCents: balanceDue(m.amount_due_cents, m.paid_cents),
    freezes: m.freezes, freezeDaysUsed: usedFreezeDays, freezeDaysAllowed: m.max_freeze_days,
    planActive: !!m.plan_active, replacesId: m.replaces_id, createdAt: m.created_at,
  };
}

interface PlanRow { id: number; name: string; duration_days: number; price_cents: number; active: number; max_freeze_days: number }
function activePlan(planId: number): PlanRow {
  const plan = one<PlanRow>('SELECT * FROM plans WHERE id = ?', [planId]);
  if (!plan) throw notFound('El plan');
  if (!plan.active) throw conflict('PLAN_INACTIVE', `El plan ${plan.name} ya no está a la venta. Elige otro.`);
  return plan;
}

const paymentInput = z.object({
  amountCents: money,
  method: z.enum(METHODS),
  reference: z.string().trim().max(60).nullable().optional(),
}).strict();
type PaymentInput = z.infer<typeof paymentInput>;

function payIfRequested(memberId: number, membershipId: number, payment: PaymentInput | undefined, actor: AuthUser, ip?: string): PaymentRow | null {
  if (!payment) return null;
  return registerPayment({ memberId, membershipId, ...payment }, actor, ip);
}

/** Venta de plan. Sin fecha: continúa tras la membresía vigente (renovación anticipada sin solaparse). */
export function sellPlan(
  input: { memberId: number; planId: number; startDate?: string; payment?: PaymentInput },
  actor: AuthUser, ip?: string,
) {
  return tx(() => {
    if (!one('SELECT id FROM members WHERE id = ?', [input.memberId])) throw notFound('El socio');
    const plan = activePlan(input.planId);
    const today = todayLocal();
    const actives = memberMemberships(input.memberId).filter((m) => m.status === 'active');
    const latest = [...actives].sort((a, b) => b.end_date.localeCompare(a.end_date))[0] ?? null;
    const start = input.startDate ?? renewalStart(latest, today);
    if (start < today) throw unprocessable('START_IN_PAST', 'La fecha de inicio no puede ser anterior a hoy.');
    const end = endDateFor(start, plan.duration_days);
    const overlap = actives.find((m) => !(end < m.start_date || start > m.end_date));
    if (overlap) {
      throw conflict('MEMBERSHIP_OVERLAP',
        `Ya tiene el plan ${overlap.plan_name} del ${formatDate(overlap.start_date)} al ${formatDate(overlap.end_date)}. Usa renovar o cambiar de plan.`);
    }
    const id = insert(
      `INSERT INTO memberships (member_id, plan_id, start_date, end_date, list_price_cents, amount_due_cents, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [input.memberId, plan.id, start, end, plan.price_cents, plan.price_cents, actor.id, clock.now().toISOString()],
    );
    audit(actor, 'membership.sell', 'membership', id, { plan_id: plan.id, start, end, price_cents: plan.price_cents }, ip);
    const payment = payIfRequested(input.memberId, id, input.payment, actor, ip);
    return { membership: viewMembership(loadMembership(id)!), payment };
  });
}

export function renewMembership(membershipId: number, payment: PaymentInput | undefined, actor: AuthUser, ip?: string) {
  const m = loadMembership(membershipId);
  if (!m) throw notFound('La membresía');
  if (m.status !== 'active') throw conflict('MEMBERSHIP_NOT_ACTIVE', 'Solo se renuevan membresías activas.');
  return sellPlan({ memberId: m.member_id, planId: m.plan_id, payment }, actor, ip);
}

export function previewChange(membershipId: number, planId: number) {
  const m = loadMembership(membershipId);
  if (!m) throw notFound('La membresía');
  const today = todayLocal();
  if (m.status !== 'active' || m.end_date < today) throw conflict('MEMBERSHIP_NOT_ACTIVE', 'Solo se cambia de plan una membresía vigente.');
  if (m.plan_id === planId) throw unprocessable('SAME_PLAN', 'Elige un plan distinto al actual.');
  const plan = activePlan(planId);
  const freezeNow = m.freezes.some((f) => f.end_date >= today);
  if (freezeNow) throw conflict('FREEZE_PENDING', 'Tiene un congelamiento en curso o programado. Reactívalo antes de cambiar de plan.');
  const queued = memberMemberships(m.member_id).some((x) => x.status === 'active' && x.id !== m.id && x.start_date > m.start_date);
  if (queued) throw conflict('MEMBERSHIP_QUEUED', 'Ya tiene una renovación programada. Cámbiela en lugar de esta membresía.');
  const p = prorate({
    old: { start_date: m.start_date, end_date: m.end_date, list_price_cents: m.list_price_cents, credit_cents: m.credit_cents, paid_cents: m.paid_cents },
    newPriceCents: plan.price_cents,
    today,
  });
  const start = today < m.start_date ? m.start_date : today;
  return { membership: m, plan, proration: p, newStart: start, newEnd: endDateFor(start, plan.duration_days) };
}

export function changePlan(membershipId: number, planId: number, payment: PaymentInput | undefined, actor: AuthUser, ip?: string) {
  return tx(() => {
    const { membership: m, plan, proration: p, newStart, newEnd } = previewChange(membershipId, planId);
    const today = todayLocal();
    const oldEnd = addDays(today, -1) < m.start_date ? m.start_date : addDays(today, -1);
    run("UPDATE memberships SET status = 'replaced', end_date = ?, amount_due_cents = ? WHERE id = ?", [oldEnd, p.oldAmountDueCents, m.id]);
    const id = insert(
      `INSERT INTO memberships (member_id, plan_id, start_date, end_date, list_price_cents, credit_cents, amount_due_cents, replaces_id, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.member_id, plan.id, newStart, newEnd, plan.price_cents, p.creditCents, p.newAmountDueCents, m.id, actor.id, clock.now().toISOString()],
    );
    audit(actor, 'membership.change_plan', 'membership', id, { from_membership: m.id, from_plan: m.plan_id, to_plan: plan.id, proration: p }, ip);
    const pay = p.newAmountDueCents > 0 ? payIfRequested(m.member_id, id, payment, actor, ip) : null;
    return { membership: viewMembership(loadMembership(id)!), proration: p, payment: pay };
  });
}

export function freezeMembership(membershipId: number, input: { startDate: string; days: number; reason: string }, actor: AuthUser, ip?: string) {
  return tx(() => {
    const m = loadMembership(membershipId);
    if (!m) throw notFound('La membresía');
    const s = getSettings();
    const used = m.freezes.reduce((sum, f) => sum + spanDays(f.start_date, f.end_date), 0);
    const check = checkFreeze({
      membership: m, maxFreezeDays: m.max_freeze_days, minFreezeDays: s.freeze_min_days, usedFreezeDays: used,
      start: input.startDate, days: input.days, today: todayLocal(),
    });
    if (!check.ok) throw unprocessable(check.code, check.message);
    const fid = insert(
      'INSERT INTO membership_freezes (membership_id, start_date, end_date, reason, created_by) VALUES (?, ?, ?, ?, ?)',
      [m.id, input.startDate, check.end, input.reason, actor.id],
    );
    run('UPDATE memberships SET end_date = ? WHERE id = ?', [check.newMembershipEnd, m.id]);
    // Las renovaciones ya programadas se desplazan para no solaparse.
    run(`UPDATE memberships SET start_date = date(start_date, '+' || :d || ' days'), end_date = date(end_date, '+' || :d || ' days')
         WHERE member_id = :member AND status = 'active' AND id <> :id AND start_date > :oldEnd`,
      { d: input.days, member: m.member_id, id: m.id, oldEnd: m.end_date });
    audit(actor, 'membership.freeze', 'membership', m.id, { freeze_id: fid, ...input, new_end: check.newMembershipEnd }, ip);
    return viewMembership(loadMembership(m.id)!);
  });
}

export function endFreeze(membershipId: number, freezeId: number, actor: AuthUser, ip?: string) {
  return tx(() => {
    const m = loadMembership(membershipId);
    const f = m?.freezes.find((x) => x.id === freezeId);
    if (!m || !f) throw notFound('El congelamiento');
    const today = todayLocal();
    if (f.end_date < today) throw conflict('FREEZE_FINISHED', 'Este congelamiento ya terminó.');
    const r = endFreezeEarly(f, m.end_date, today);
    if (r.cancelWhole) run('DELETE FROM membership_freezes WHERE id = ?', [f.id]);
    else run('UPDATE membership_freezes SET end_date = ?, ended_early_at = ? WHERE id = ?', [r.newFreezeEnd, clock.now().toISOString(), f.id]);
    run('UPDATE memberships SET end_date = ? WHERE id = ?', [r.newMembershipEnd, m.id]);
    run(`UPDATE memberships SET start_date = date(start_date, '-' || :d || ' days'), end_date = date(end_date, '-' || :d || ' days')
         WHERE member_id = :member AND status = 'active' AND id <> :id AND start_date > :oldEnd`,
      { d: r.daysReturned, member: m.member_id, id: m.id, oldEnd: m.end_date });
    audit(actor, 'membership.unfreeze', 'membership', m.id, { freeze_id: f.id, days_returned: r.daysReturned, cancelled: r.cancelWhole }, ip);
    return viewMembership(loadMembership(m.id)!);
  });
}

function membershipOf(id: number, user: AuthUser) {
  const m = one<{ member_id: number }>('SELECT member_id FROM memberships WHERE id = ?', [id]);
  if (!m) throw notFound('La membresía');
  assertMemberAccess(user, m.member_id, 'basic');
  return m;
}

export const membershipRoutes = [
  route({
    method: 'get', path: '/plans', tag: 'Membresías', summary: 'Planes disponibles', auth: 'any',
    query: z.object({ all: z.enum(['true', 'false']).optional() }).strict(),
    handler: ({ query, user }) => {
      const showAll = query.all === 'true' && user.role === 'admin';
      return all(`SELECT * FROM plans ${showAll ? '' : 'WHERE active = 1'} ORDER BY duration_days, price_cents`)
        .map((p) => ({ ...(p as object), active: !!(p as { active: number }).active, includes_classes: !!(p as { includes_classes: number }).includes_classes }));
    },
  }),
  route({
    method: 'get', path: '/members/:id/memberships', tag: 'Membresías', summary: 'Historial de membresías de un socio', auth: 'any',
    params: idParam,
    handler: ({ params, user }) => {
      assertMemberAccess(user, params.id, 'basic');
      const today = todayLocal();
      const list = memberMemberships(params.id);
      const current = pickCurrent(list, today);
      return { current: current ? viewMembership(current, today) : null, items: list.map((m) => viewMembership(m, today)) };
    },
  }),
  route({
    method: 'post', path: '/members/:id/memberships', tag: 'Membresías', summary: 'Vender plan (con pago opcional)', status: 201, auth: ['reception', 'admin'],
    params: idParam,
    body: z.object({ planId: z.number().int().positive(), startDate: isoDate.optional(), payment: paymentInput.optional() }).strict(),
    handler: ({ params, body, user, ip }) => sellPlan({ memberId: params.id, ...body }, user, ip),
  }),
  route({
    method: 'post', path: '/memberships/:id/renew', tag: 'Membresías', summary: 'Renovar en un clic (mismo plan, sin huecos)', status: 201, auth: ['reception', 'admin'],
    params: idParam,
    body: z.object({ payment: paymentInput.optional() }).strict(),
    handler: ({ params, body, user, ip }) => renewMembership(params.id, body.payment, user, ip),
  }),
  route({
    method: 'get', path: '/memberships/:id/change-plan', tag: 'Membresías', summary: 'Simular cambio de plan con prorrateo', auth: ['reception', 'admin'],
    params: idParam,
    query: z.object({ planId: z.coerce.number().int().positive() }).strict(),
    handler: ({ params, query }) => {
      const r = previewChange(params.id, query.planId);
      return { proration: r.proration, plan: { id: r.plan.id, name: r.plan.name, priceCents: r.plan.price_cents }, newStart: r.newStart, newEnd: r.newEnd };
    },
  }),
  route({
    method: 'post', path: '/memberships/:id/change-plan', tag: 'Membresías', summary: 'Cambiar de plan (prorrateo)', status: 201, auth: ['reception', 'admin'],
    params: idParam,
    body: z.object({ planId: z.number().int().positive(), payment: paymentInput.optional() }).strict(),
    handler: ({ params, body, user, ip }) => changePlan(params.id, body.planId, body.payment, user, ip),
  }),
  route({
    method: 'post', path: '/memberships/:id/freezes', tag: 'Membresías', summary: 'Congelar membresía', status: 201, auth: ['reception', 'admin'],
    description: 'Los días congelados se suman al vencimiento. Mínimo y máximo configurables por plan y en ajustes.',
    params: idParam,
    body: z.object({
      startDate: isoDate,
      days: z.number().int().min(1).max(180),
      reason: z.string().trim().min(3, 'Indica el motivo').max(200),
    }).strict(),
    handler: ({ params, body, user, ip }) => { membershipOf(params.id, user); return freezeMembership(params.id, body, user, ip); },
  }),
  route({
    method: 'post', path: '/memberships/:id/freezes/:freezeId/end', tag: 'Membresías', summary: 'Reactivar antes de tiempo', auth: ['reception', 'admin'],
    params: z.object({ id: z.coerce.number().int().positive(), freezeId: z.coerce.number().int().positive() }).strict(),
    handler: ({ params, user, ip }) => endFreeze(params.id, params.freezeId, user, ip),
  }),
];



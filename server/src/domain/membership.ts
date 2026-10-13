import { addDays, diffDays, spanDays } from '../lib/dates.ts';

/**
 * Reglas de membresía puras (sin BD). Fechas en calendario local del gimnasio; end_date inclusiva.
 */
export type MembershipState =
  | 'none'          // sin plan
  | 'not_started'   // comprada, empieza en el futuro
  | 'active'
  | 'expiring'      // vence dentro de N días
  | 'expires_today' // último día válido: hoy SÍ puede ingresar
  | 'frozen'
  | 'expired';

export interface FreezeLike { start_date: string; end_date: string }
export interface MembershipLike {
  start_date: string;
  end_date: string;
  status: 'active' | 'replaced' | 'cancelled';
  freezes?: FreezeLike[];
}

export interface StateResult {
  state: MembershipState;
  daysLeft: number | null;       // días restantes incluyendo hoy - 1 (0 = vence hoy)
  frozenUntil: string | null;
}

export function membershipState(m: MembershipLike | null | undefined, today: string, expiringDays: number): StateResult {
  if (!m || m.status !== 'active') return { state: 'none', daysLeft: null, frozenUntil: null };
  if (today < m.start_date) return { state: 'not_started', daysLeft: diffDays(today, m.end_date), frozenUntil: null };
  if (today > m.end_date) return { state: 'expired', daysLeft: diffDays(today, m.end_date), frozenUntil: null };
  const freeze = (m.freezes ?? []).find((f) => f.start_date <= today && today <= f.end_date);
  const daysLeft = diffDays(today, m.end_date);
  if (freeze) return { state: 'frozen', daysLeft, frozenUntil: freeze.end_date };
  if (daysLeft === 0) return { state: 'expires_today', daysLeft, frozenUntil: null };
  if (daysLeft <= expiringDays) return { state: 'expiring', daysLeft, frozenUntil: null };
  return { state: 'active', daysLeft, frozenUntil: null };
}

export const ACCESS_STATES: MembershipState[] = ['active', 'expiring', 'expires_today'];
export const canAccess = (s: MembershipState) => ACCESS_STATES.includes(s);

/** Si una membresía es válida en una fecha dada (para reservar clases de días futuros). */
export function validOn(m: MembershipLike, date: string): boolean {
  if (m.status !== 'active' || date < m.start_date || date > m.end_date) return false;
  return !(m.freezes ?? []).some((f) => f.start_date <= date && date <= f.end_date);
}

/** Renovación en un clic: continúa sin huecos si sigue vigente; si ya venció, empieza hoy. */
export function renewalStart(current: Pick<MembershipLike, 'end_date'> | null, today: string): string {
  if (!current || current.end_date < today) return today;
  return addDays(current.end_date, 1);
}

export function endDateFor(start: string, durationDays: number): string {
  return addDays(start, durationDays - 1);
}

// ------------------------------------------------------------------ Congelamiento

export interface FreezeRequest {
  membership: MembershipLike & { id?: number };
  maxFreezeDays: number;
  minFreezeDays: number;
  usedFreezeDays: number;
  start: string;
  days: number;
  today: string;
}

export type FreezeCheck = { ok: true; end: string; newMembershipEnd: string } | { ok: false; code: string; message: string };

export function checkFreeze(r: FreezeRequest): FreezeCheck {
  const { membership: m } = r;
  if (m.status !== 'active') return { ok: false, code: 'MEMBERSHIP_NOT_ACTIVE', message: 'Solo se congelan membresías activas.' };
  if (r.maxFreezeDays === 0) return { ok: false, code: 'FREEZE_NOT_ALLOWED', message: 'Este plan no permite congelamiento.' };
  if (r.start < r.today) return { ok: false, code: 'FREEZE_IN_PAST', message: 'El congelamiento no puede empezar en el pasado.' };
  if (r.start > m.end_date) return { ok: false, code: 'FREEZE_AFTER_END', message: 'El congelamiento debe empezar antes del vencimiento.' };
  if (r.days < r.minFreezeDays) return { ok: false, code: 'FREEZE_TOO_SHORT', message: `El congelamiento mínimo es de ${r.minFreezeDays} días.` };
  if (r.usedFreezeDays + r.days > r.maxFreezeDays) {
    const left = Math.max(0, r.maxFreezeDays - r.usedFreezeDays);
    return { ok: false, code: 'FREEZE_LIMIT', message: `Le quedan ${left} días de congelamiento en este plan.` };
  }
  const end = addDays(r.start, r.days - 1);
  const overlap = (m.freezes ?? []).some((f) => !(end < f.start_date || r.start > f.end_date));
  if (overlap) return { ok: false, code: 'FREEZE_OVERLAP', message: 'Ya hay un congelamiento en esas fechas.' };
  // Los días congelados se devuelven al final de la membresía.
  return { ok: true, end, newMembershipEnd: addDays(m.end_date, r.days) };
}

/**
 * Reactivación anticipada. Si aún no empezó, se anula completo; si está en curso, termina ayer
 * (hoy ya puede ingresar) y se descuentan del vencimiento los días no usados.
 */
export function endFreezeEarly(f: FreezeLike, membershipEnd: string, today: string):
  { cancelWhole: boolean; newFreezeEnd: string | null; daysReturned: number; newMembershipEnd: string } {
  if (today <= f.start_date) {
    const days = spanDays(f.start_date, f.end_date);
    return { cancelWhole: true, newFreezeEnd: null, daysReturned: days, newMembershipEnd: addDays(membershipEnd, -days) };
  }
  const newFreezeEnd = addDays(today, -1);
  const unused = Math.max(0, diffDays(newFreezeEnd, f.end_date));
  return { cancelWhole: false, newFreezeEnd, daysReturned: unused, newMembershipEnd: addDays(membershipEnd, -unused) };
}

// --------------------------------------------------------------------- Prorrateo

export interface ProrationInput {
  old: { start_date: string; end_date: string; list_price_cents: number; credit_cents: number; paid_cents: number };
  newPriceCents: number;
  today: string;
}

export interface ProrationResult {
  totalDays: number;
  consumedDays: number;
  remainingDays: number;
  consumedValueCents: number;   // valor de lo ya usado del plan anterior
  oldAmountDueCents: number;    // lo que queda debiendo la membresía anterior (si no la pagó)
  creditCents: number;          // saldo a favor aplicado al nuevo plan
  leftoverCreditCents: number;  // excedente no aplicable (si el plan nuevo es más barato que el crédito)
  newAmountDueCents: number;    // lo que se cobra por el nuevo plan
}

/**
 * Cambio de plan con prorrateo. El nuevo plan empieza hoy.
 *  - Valor consumido = precio de lista × días usados / días totales (redondeado al céntimo).
 *  - Lo pagado (incluido crédito heredado) por encima de lo consumido pasa como crédito.
 *  - Si no había pagado lo consumido, esa diferencia queda como deuda de la membresía anterior.
 * Invariante: total pagado + deudas = valor consumido + precio del plan nuevo − excedente.
 */
export function prorate({ old, newPriceCents, today }: ProrationInput): ProrationResult {
  const totalDays = spanDays(old.start_date, old.end_date);
  const consumedDays = today <= old.start_date ? 0 : Math.min(totalDays, diffDays(old.start_date, today));
  const remainingDays = totalDays - consumedDays;
  const consumedValueCents = Math.round((old.list_price_cents * consumedDays) / totalDays);
  const effectivePaid = old.paid_cents + old.credit_cents;
  const credit = Math.max(0, effectivePaid - consumedValueCents);
  const creditCents = Math.min(credit, newPriceCents);
  return {
    totalDays,
    consumedDays,
    remainingDays,
    consumedValueCents,
    oldAmountDueCents: Math.max(0, consumedValueCents - old.credit_cents),
    creditCents,
    leftoverCreditCents: credit - creditCents,
    newAmountDueCents: newPriceCents - creditCents,
  };
}

/** Deuda de una membresía: lo que falta pagar (pagos anulados no cuentan). */
export function balanceDue(amountDueCents: number, paidCents: number): number {
  return Math.max(0, amountDueCents - paidCents);
}

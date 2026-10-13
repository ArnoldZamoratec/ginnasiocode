import { z } from 'zod';
import { all, insert, one, run, tx } from '../db/db.ts';
import { route, idParam, isoDate, type AuthUser } from '../lib/http.ts';
import { AppError, notFound, unprocessable } from '../lib/errors.ts';
import { clock } from '../lib/clock.ts';
import { getSettings } from '../lib/settings.ts';
import { hmac, safeEqual } from '../lib/crypto.ts';
import { config } from '../config.ts';
import { formatDate, formatMoney, formatTime, maskDni } from '../lib/format.ts';
import { localDate, localDayRangeUtc } from '../lib/dates.ts';
import { canAccess, type MembershipState } from '../domain/membership.ts';
import { assertMemberAccess } from './access-control.ts';
import { memberMemberships, pickCurrent, todayLocal, viewMembership } from './memberships.ts';
import { memberDebt, METHODS, registerPayment } from './payments.ts';
import { audit } from '../lib/audit.ts';

// ---------------------------------------------------------------- Pase QR
// Formato: G1.<memberId>.<expUnix>.<firma>. La firma HMAC impide falsificarlo y la expiración
// corta (60 s por defecto) hace inútil una captura de pantalla compartida.
const PASS_PREFIX = 'G1';

export function issuePass(memberId: number, now = clock.now()) {
  const ttl = getSettings().pass_ttl_seconds;
  const exp = Math.floor(now.getTime() / 1000) + ttl;
  const sig = hmac(config.passSecret, `${memberId}.${exp}`).slice(0, 22);
  return { payload: `${PASS_PREFIX}.${memberId}.${exp}.${sig}`, expiresAt: new Date(exp * 1000).toISOString(), ttlSeconds: ttl };
}

type PassCheck = { ok: true; memberId: number } | { ok: false; memberId?: number; code: 'INVALID_PASS' | 'PASS_EXPIRED' };

export function verifyPass(payload: string, now = clock.now()): PassCheck {
  const parts = payload.trim().split('.');
  if (parts.length !== 4 || parts[0] !== PASS_PREFIX) return { ok: false, code: 'INVALID_PASS' };
  const [, mid, exp, sig] = parts;
  if (!/^\d+$/.test(mid) || !/^\d+$/.test(exp)) return { ok: false, code: 'INVALID_PASS' };
  if (!safeEqual(sig, hmac(config.passSecret, `${mid}.${exp}`).slice(0, 22))) return { ok: false, code: 'INVALID_PASS' };
  // 10 s de tolerancia para desfase de relojes entre celular y servidor.
  if (Number(exp) * 1000 + 10_000 < now.getTime()) return { ok: false, memberId: Number(mid), code: 'PASS_EXPIRED' };
  return { ok: true, memberId: Number(mid) };
}

// --------------------------------------------------------------- Check-in

const DENY_MESSAGE: Record<string, (v: ReturnType<typeof viewMembership> | null) => string> = {
  NO_MEMBERSHIP: () => 'No tiene un plan activo.',
  NOT_STARTED: (v) => `Su plan empieza el ${formatDate(v!.startDate)}.`,
  EXPIRED: (v) => `Su plan venció el ${formatDate(v!.endDate)}.`,
  FROZEN: (v) => `Plan congelado hasta el ${formatDate(v!.frozenUntil!)}.`,
  DEBT: () => 'Tiene deuda pendiente. Regulariza el pago para ingresar.',
  PASS_EXPIRED: () => 'El código QR expiró. Pide al socio que lo actualice en su app.',
};

const STATE_TO_REASON: Partial<Record<MembershipState, string>> = {
  none: 'NO_MEMBERSHIP', not_started: 'NOT_STARTED', expired: 'EXPIRED', frozen: 'FROZEN',
};

export interface CheckInInput { code?: string; memberId?: number; branchId: number }

export function checkIn(input: CheckInInput, actor: AuthUser) {
  const settings = getSettings();
  const now = clock.now();
  let memberId: number | undefined = input.memberId;
  let method: 'qr' | 'dni' | 'manual' = 'manual';
  let passProblem: string | null = null;

  if (!one('SELECT id FROM branches WHERE id = ? AND active = 1', [input.branchId])) throw notFound('La sede');

  if (input.code) {
    const code = input.code.trim();
    if (code.startsWith(`${PASS_PREFIX}.`)) {
      method = 'qr';
      const r = verifyPass(code, now);
      if (!r.ok && r.code === 'INVALID_PASS') throw unprocessable('INVALID_PASS', 'Código no reconocido. Prueba con el DNI.');
      memberId = r.memberId;
      if (!r.ok) passProblem = r.code;
    } else {
      method = 'dni';
      const m = one<{ id: number }>('SELECT id FROM members WHERE dni = ?', [code.toUpperCase()]);
      if (!m) throw new AppError(404, 'MEMBER_NOT_FOUND', 'No encontramos un socio con ese documento.');
      memberId = m.id;
    }
  }
  const member = one<{ id: number; first_name: string; last_name: string; dni: string; trainer_name: string | null }>(
    'SELECT m.*, t.full_name trainer_name FROM members m LEFT JOIN users t ON t.id = m.trainer_id WHERE m.id = ?', [memberId ?? 0],
  );
  if (!member) throw new AppError(404, 'MEMBER_NOT_FOUND', 'No encontramos a ese socio.');

  const today = todayLocal();
  const cur = pickCurrent(memberMemberships(member.id), today);
  const view = cur ? viewMembership(cur, today) : null;
  const state = (view?.state ?? 'none') as MembershipState;
  const debt = memberDebt(member.id);

  let reason: string | null = passProblem;
  if (!reason && !canAccess(state)) reason = STATE_TO_REASON[state] ?? 'NO_MEMBERSHIP';
  if (!reason && debt.totalCents > 0 && !settings.checkin_allow_with_debt) reason = 'DEBT';

  const warnings: { code: string; message: string }[] = [];
  if (state === 'expires_today') warnings.push({ code: 'EXPIRES_TODAY', message: 'Hoy es el último día de su plan.' });
  if (state === 'expiring') warnings.push({ code: 'EXPIRING', message: `Su plan vence en ${view!.daysLeft} ${view!.daysLeft === 1 ? 'día' : 'días'} (${formatDate(view!.endDate)}).` });
  if (debt.totalCents > 0) warnings.push({ code: 'DEBT', message: `Deuda pendiente: ${formatMoney(debt.totalCents)}.` });

  const result = tx(() => {
    if (!reason) {
      const since = new Date(now.getTime() - settings.checkin_dedupe_minutes * 60_000).toISOString();
      const recent = one<{ id: number; checked_in_at: string }>(
        "SELECT id, checked_in_at FROM visits WHERE member_id = ? AND result = 'granted' AND checked_in_at >= ? ORDER BY checked_in_at DESC LIMIT 1",
        [member.id, since],
      );
      if (recent) return { visitId: recent.id, checkedInAt: recent.checked_in_at, duplicate: true };
    }
    const visitId = insert(
      'INSERT INTO visits (member_id, membership_id, branch_id, method, result, reason, checked_in_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [member.id, cur?.id ?? null, input.branchId, method, reason ? 'denied' : 'granted', reason, now.toISOString(), actor.id],
    );
    if (!reason) {
      // Marca asistencia a clases reservadas que empiezan entre 30 min antes y 3 h después del ingreso.
      run(`UPDATE reservations SET status = 'attended' WHERE member_id = ? AND status = 'booked' AND session_id IN (
             SELECT id FROM class_sessions WHERE status = 'scheduled' AND starts_at BETWEEN ? AND ?)`,
        [member.id, new Date(now.getTime() - 30 * 60_000).toISOString(), new Date(now.getTime() + 3 * 3_600_000).toISOString()]);
    }
    return { visitId, checkedInAt: now.toISOString(), duplicate: false };
  });

  const { from, to } = localDayRangeUtc(today, settings.timezone);
  const classesToday = all<{ class_name: string; starts_at: string; status: string }>(
    `SELECT ct.name class_name, s.starts_at, r.status FROM reservations r JOIN class_sessions s ON s.id = r.session_id
     JOIN class_types ct ON ct.id = s.class_type_id
     WHERE r.member_id = ? AND r.status IN ('booked','waitlist','attended') AND s.status = 'scheduled' AND s.starts_at >= ? AND s.starts_at < ?
     ORDER BY s.starts_at`, [member.id, from, to],
  ).map((c) => ({ className: c.class_name, time: formatTime(c.starts_at), status: c.status }));

  return {
    result: reason ? 'denied' as const : 'granted' as const,
    reason,
    message: reason ? DENY_MESSAGE[reason](view) : result.duplicate ? 'Ya registró su ingreso hace unos minutos.' : 'Acceso autorizado.',
    duplicate: result.duplicate,
    visitId: result.visitId,
    checkedInAt: result.checkedInAt,
    method,
    member: {
      id: member.id, fullName: `${member.first_name} ${member.last_name}`, dni: maskDni(member.dni),
      initials: `${member.first_name[0]}${member.last_name[0]}`.toUpperCase(), trainerName: member.trainer_name,
    },
    membership: view,
    debtCents: debt.totalCents,
    warnings,
    classesToday,
  };
}

export const checkinRoutes = [
  route({
    method: 'get', path: '/me/pass', tag: 'Acceso', summary: 'Pase de ingreso QR (rota cada minuto)', auth: ['member'],
    handler: ({ user }) => issuePass(user.memberId!),
  }),
  route({
    method: 'post', path: '/checkin', tag: 'Acceso', summary: 'Registrar ingreso por QR, DNI o selección manual', auth: ['reception', 'admin'],
    description: 'Valida la membresía (vigencia, congelamiento, inicio futuro). Los rechazos también quedan registrados. Un segundo escaneo dentro de la ventana configurada no duplica la visita.',
    body: z.object({
      code: z.string().trim().min(4).max(200).optional(),
      memberId: z.number().int().positive().optional(),
      branchId: z.number().int().positive(),
    }).strict().refine((b) => !!b.code !== !!b.memberId, { message: 'Envía un código (QR o DNI) o un socio, no ambos', path: ['code'] }),
    handler: ({ body, user }) => checkIn(body, user),
  }),
  route({
    method: 'get', path: '/checkin/recent', tag: 'Acceso', summary: 'Últimos ingresos (feed de recepción)', auth: ['reception', 'admin'],
    query: z.object({ branchId: z.coerce.number().int().positive().optional() }).strict(),
    handler: ({ query }) => {
      const { from } = localDayRangeUtc(todayLocal(), getSettings().timezone);
      const rows = all<{ id: number; member_id: number; first_name: string; last_name: string; result: string; reason: string | null; method: string; checked_in_at: string }>(
        `SELECT v.id, v.member_id, m.first_name, m.last_name, v.result, v.reason, v.method, v.checked_in_at
         FROM visits v JOIN members m ON m.id = v.member_id
         WHERE v.checked_in_at >= :from ${query.branchId ? 'AND v.branch_id = :branch' : ''}
         ORDER BY v.checked_in_at DESC LIMIT 40`, { from, branch: query.branchId },
      );
      const inside = one<{ n: number }>(
        `SELECT COUNT(DISTINCT member_id) n FROM visits WHERE result = 'granted' AND checked_in_at >= ? ${query.branchId ? 'AND branch_id = ?' : ''}`,
        query.branchId ? [new Date(clock.now().getTime() - 90 * 60_000).toISOString(), query.branchId] : [new Date(clock.now().getTime() - 90 * 60_000).toISOString()],
      )!.n;
      const todayCount = one<{ n: number }>("SELECT COUNT(*) n FROM visits WHERE result = 'granted' AND checked_in_at >= ?", [from])!.n;
      return { items: rows.map((r) => ({ ...r, fullName: `${r.first_name} ${r.last_name}` })), estimatedInside: inside, todayCount };
    },
  }),
  route({
    method: 'get', path: '/members/:id/visits', tag: 'Acceso', summary: 'Historial de visitas de un socio', auth: 'any',
    params: idParam,
    query: z.object({ limit: z.coerce.number().int().min(1).max(500).default(60) }).strict(),
    handler: ({ params, query, user }) => {
      assertMemberAccess(user, params.id, 'basic');
      const tz = getSettings().timezone;
      const items = all<{ id: number; checked_in_at: string; result: string; reason: string | null; method: string; branch_name: string }>(
        `SELECT v.id, v.checked_in_at, v.result, v.reason, v.method, b.name branch_name FROM visits v JOIN branches b ON b.id = v.branch_id
         WHERE v.member_id = ? ORDER BY v.checked_in_at DESC LIMIT ?`, [params.id, query.limit],
      );
      // Días distintos con asistencia (para el calendario de constancia del socio)
      const days = [...new Set(items.filter((i) => i.result === 'granted').map((i) => localDate(i.checked_in_at, tz)))];
      return { items, days };
    },
  }),
  route({
    method: 'post', path: '/guest-visits', tag: 'Acceso', summary: 'Registrar visita de invitado (pase diario, prueba o recorrido)', status: 201, auth: ['reception', 'admin'],
    body: z.object({
      fullName: z.string().trim().min(3).max(100),
      dni: z.string().trim().toUpperCase().regex(/^[0-9A-Z]{8,12}$/).optional().nullable(),
      phone: z.string().trim().regex(/^\+?[0-9 ]{6,16}$/).optional().nullable(),
      kind: z.enum(['day_pass', 'trial', 'tour']),
      branchId: z.number().int().positive(),
      notes: z.string().trim().max(300).optional().nullable(),
      payment: z.object({ method: z.enum(METHODS), reference: z.string().trim().max(60).optional().nullable() }).strict().optional(),
    }).strict().refine((b) => b.kind !== 'day_pass' || !!b.payment, { message: 'El pase diario requiere registrar el pago', path: ['payment'] }),
    handler: ({ body, user, ip }) => tx(() => {
      let paymentId: number | null = null;
      if (body.kind === 'day_pass' && body.payment) {
        const price = getSettings().day_pass_price_cents;
        paymentId = registerPayment({
          memberId: null, amountCents: price, method: body.payment.method, reference: body.payment.reference ?? null,
          concept: `Pase diario · ${body.fullName}`, branchId: body.branchId,
        }, user, ip).id;
      }
      const id = insert(
        'INSERT INTO guest_visits (full_name, dni, phone, kind, branch_id, notes, payment_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [body.fullName, body.dni ?? null, body.phone ?? null, body.kind, body.branchId, body.notes ?? null, paymentId, user.id, clock.now().toISOString()],
      );
      audit(user, 'guest_visit.create', 'guest_visit', id, { kind: body.kind }, ip);
      return one('SELECT * FROM guest_visits WHERE id = ?', [id]);
    }),
  }),
  route({
    method: 'get', path: '/guest-visits', tag: 'Acceso', summary: 'Visitas de invitados del día', auth: ['reception', 'admin'],
    query: z.object({ date: isoDate.optional() }).strict(),
    handler: ({ query }) => {
      const { from, to } = localDayRangeUtc(query.date ?? todayLocal(), getSettings().timezone);
      return all(
        `SELECT g.id, g.full_name, g.phone, g.kind, g.notes, g.created_at, p.amount_cents, p.receipt_number, p.id payment_id, u.full_name created_by_name
         FROM guest_visits g LEFT JOIN payments p ON p.id = g.payment_id LEFT JOIN users u ON u.id = g.created_by
         WHERE g.created_at >= ? AND g.created_at < ? ORDER BY g.created_at DESC`, [from, to],
      );
    },
  }),
];

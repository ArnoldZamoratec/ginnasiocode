import { z } from 'zod';
import { all, insert, one, run, tx } from '../db/db.ts';
import { route, idParam, isoDate, type AuthUser } from '../lib/http.ts';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { clock } from '../lib/clock.ts';
import { getSettings } from '../lib/settings.ts';
import { addDays, localDate, localDayRangeUtc, localToUtc, weekdayOf } from '../lib/dates.ts';
import { formatDate, formatTime } from '../lib/format.ts';
import { decideBooking, decideCancel, pickPromotions } from '../domain/classes.ts';
import { validOn } from '../domain/membership.ts';
import { memberMemberships, todayLocal } from './memberships.ts';
import { notify } from './notifications.ts';

interface SessionRow {
  id: number; schedule_id: number | null; class_type_id: number; class_name: string; intensity: number; branch_id: number; branch_name: string;
  trainer_id: number | null; trainer_name: string | null; starts_at: string; ends_at: string; capacity: number; room: string;
  status: 'scheduled' | 'cancelled'; cancel_reason: string | null; booked: number; waitlist: number;
}
interface ReservationRow { id: number; session_id: number; member_id: number; status: string; waitlist_at: string | null; promoted_at: string | null; created_at: string }

const SESSION_SQL = `
  SELECT s.*, ct.name class_name, ct.intensity, b.name branch_name, u.full_name trainer_name,
    (SELECT COUNT(*) FROM reservations r WHERE r.session_id = s.id AND r.status IN ('booked','attended')) booked,
    (SELECT COUNT(*) FROM reservations r WHERE r.session_id = s.id AND r.status = 'waitlist') waitlist
  FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id JOIN branches b ON b.id = s.branch_id
  LEFT JOIN users u ON u.id = s.trainer_id`;

function loadSession(id: number): SessionRow {
  const s = one<SessionRow>(`${SESSION_SQL} WHERE s.id = ?`, [id]);
  if (!s) throw notFound('La clase');
  return s;
}

/** Genera sesiones concretas a partir del horario semanal (idempotente por UNIQUE(schedule_id, starts_at)). */
export function generateSessions(fromDate: string, days: number): number {
  const tz = getSettings().timezone;
  const schedules = all<{ id: number; class_type_id: number; branch_id: number; trainer_id: number | null; weekday: number; start_time: string; duration_min: number; capacity: number; room: string }>(
    'SELECT * FROM class_schedules WHERE active = 1',
  );
  let created = 0;
  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    const wd = weekdayOf(date);
    for (const sc of schedules.filter((x) => x.weekday === wd)) {
      const start = localToUtc(date, sc.start_time, tz);
      const end = new Date(start.getTime() + sc.duration_min * 60_000);
      created += run(
        `INSERT OR IGNORE INTO class_sessions (schedule_id, class_type_id, branch_id, trainer_id, starts_at, ends_at, capacity, room)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [sc.id, sc.class_type_id, sc.branch_id, sc.trainer_id, start.toISOString(), end.toISOString(), sc.capacity, sc.room],
      ).changes;
    }
  }
  return created;
}

/** ¿El socio puede asistir a una clase en esa fecha? Plan vigente ese día, no congelado, y que incluya clases. */
function eligibleForDate(memberId: number, date: string): { ok: true } | { ok: false; code: string; message: string } {
  const ms = memberMemberships(memberId).filter((m) => validOn(m, date));
  if (!ms.length) return { ok: false, code: 'MEMBERSHIP_REQUIRED', message: `Tu plan no está vigente el ${formatDate(date)}.` };
  if (!ms.some((m) => m.includes_classes)) return { ok: false, code: 'PLAN_EXCLUDES_CLASSES', message: 'Tu plan no incluye clases grupales.' };
  return { ok: true };
}

function waitlistPosition(r: ReservationRow): number | null {
  if (r.status !== 'waitlist') return null;
  return one<{ n: number }>(
    `SELECT COUNT(*) n FROM reservations WHERE session_id = ? AND status = 'waitlist' AND (waitlist_at < ? OR (waitlist_at = ? AND id <= ?))`,
    [r.session_id, r.waitlist_at, r.waitlist_at, r.id],
  )!.n;
}

export function book(sessionId: number, memberId: number, actor: AuthUser) {
  return tx(() => {
    const s = loadSession(sessionId);
    const now = clock.now();
    const tz = getSettings().timezone;
    const elig = eligibleForDate(memberId, localDate(s.starts_at, tz));
    if (!elig.ok) throw unprocessable(elig.code, elig.message);
    const live = one<{ id: number }>("SELECT id FROM reservations WHERE session_id = ? AND member_id = ? AND status IN ('booked','waitlist','attended')", [sessionId, memberId]);
    const d = decideBooking({ session: s, bookedCount: s.booked, now, windowDays: getSettings().booking_window_days, hasLiveReservation: !!live });
    if (!d.ok) throw conflict(d.code, d.message);
    const clash = one<{ class_name: string; starts_at: string }>(
      `SELECT ct.name class_name, cs.starts_at FROM reservations r JOIN class_sessions cs ON cs.id = r.session_id JOIN class_types ct ON ct.id = cs.class_type_id
       WHERE r.member_id = ? AND r.status = 'booked' AND cs.status = 'scheduled' AND cs.id <> ? AND cs.starts_at < ? AND cs.ends_at > ?`,
      [memberId, sessionId, s.ends_at, s.starts_at],
    );
    if (clash) throw conflict('CLASS_OVERLAP', `Ya tienes ${clash.class_name} a las ${formatTime(clash.starts_at)}.`);
    const id = insert(
      'INSERT INTO reservations (session_id, member_id, status, waitlist_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [sessionId, memberId, d.status, d.status === 'waitlist' ? now.toISOString() : null, now.toISOString()],
    );
    if (actor.role !== 'member') audit(actor, 'reservation.create', 'reservation', id, { session_id: sessionId, member_id: memberId });
    const r = one<ReservationRow>('SELECT * FROM reservations WHERE id = ?', [id])!;
    return { reservation: r, waitlistPosition: waitlistPosition(r) };
  });
}

/** Promueve de la lista de espera (FIFO) tantos socios como cupos libres haya. Devuelve los promovidos. */
export function promoteWaitlist(sessionId: number): number[] {
  const s = loadSession(sessionId);
  const now = clock.now();
  if (s.status !== 'scheduled' || new Date(s.starts_at) <= now) return [];
  const free = s.capacity - s.booked;
  if (free <= 0) return [];
  const waitlist = all<ReservationRow & { waitlist_at: string }>("SELECT * FROM reservations WHERE session_id = ? AND status = 'waitlist'", [sessionId]);
  const date = localDate(s.starts_at, getSettings().timezone);
  const { promote } = pickPromotions(waitlist, free, (e) => eligibleForDate(e.member_id, date).ok);
  for (const r of promote) {
    run("UPDATE reservations SET status = 'booked', promoted_at = ? WHERE id = ?", [now.toISOString(), r.id]);
    notify(r.member_id, 'waitlist_promoted', { clase: s.class_name, fecha: formatDate(date), hora: formatTime(s.starts_at) }, `promoted:${r.id}`);
  }
  return promote.map((r) => r.member_id);
}

export function cancelReservation(reservationId: number, actor: AuthUser, ip?: string) {
  return tx(() => {
    const r = one<ReservationRow>('SELECT * FROM reservations WHERE id = ?', [reservationId]);
    if (!r) throw notFound('La reserva');
    if (actor.role === 'member' && r.member_id !== actor.memberId) throw forbidden();
    if (actor.role === 'trainer') throw forbidden();
    const s = loadSession(r.session_id);
    const d = decideCancel({
      reservationStatus: r.status, startsAt: s.starts_at, now: clock.now(),
      minHours: getSettings().cancel_min_hours, byStaff: actor.role !== 'member',
    });
    if (!d.ok) throw conflict(d.code, d.message);
    run("UPDATE reservations SET status = 'cancelled', cancelled_at = ?, late_cancel = ? WHERE id = ?", [clock.now().toISOString(), d.late, r.id]);
    if (actor.role !== 'member') audit(actor, 'reservation.cancel', 'reservation', r.id, { late: d.late }, ip);
    const promoted = d.freesSeat ? promoteWaitlist(r.session_id) : [];
    return { cancelled: true, late: d.late, promotedMemberIds: promoted };
  });
}

export function cancelSession(sessionId: number, reason: string, actor: AuthUser, ip?: string) {
  return tx(() => {
    const s = loadSession(sessionId);
    if (s.status === 'cancelled') throw conflict('ALREADY_CANCELLED', 'La clase ya estaba cancelada.');
    if (actor.role === 'trainer' && s.trainer_id !== actor.id) throw forbidden('Solo puedes cancelar tus propias clases.');
    if (new Date(s.ends_at) < clock.now()) throw conflict('CLASS_FINISHED', 'La clase ya terminó.');
    const affected = all<{ id: number; member_id: number }>("SELECT id, member_id FROM reservations WHERE session_id = ? AND status IN ('booked','waitlist')", [sessionId]);
    run("UPDATE class_sessions SET status = 'cancelled', cancel_reason = ? WHERE id = ?", [reason, sessionId]);
    run("UPDATE reservations SET status = 'cancelled', cancelled_at = ? WHERE session_id = ? AND status IN ('booked','waitlist')", [clock.now().toISOString(), sessionId]);
    const date = localDate(s.starts_at, getSettings().timezone);
    for (const a of affected) {
      notify(a.member_id, 'class_cancelled', { clase: s.class_name, fecha: formatDate(date), hora: formatTime(s.starts_at), motivo: reason }, `class_cancelled:${sessionId}:${a.member_id}`);
    }
    audit(actor, 'class.cancel', 'class_session', sessionId, { reason, notified: affected.length }, ip);
    return { notified: affected.length };
  });
}

function sessionView(s: SessionRow, mine?: ReservationRow) {
  return {
    id: s.id, className: s.class_name, intensity: s.intensity, branchId: s.branch_id, branchName: s.branch_name,
    trainerId: s.trainer_id, trainerName: s.trainer_name, startsAt: s.starts_at, endsAt: s.ends_at, room: s.room,
    capacity: s.capacity, booked: s.booked, waitlist: s.waitlist, spotsLeft: Math.max(0, s.capacity - s.booked),
    status: s.status, cancelReason: s.cancel_reason,
    myReservation: mine ? { id: mine.id, status: mine.status, waitlistPosition: waitlistPosition(mine) } : null,
  };
}

const scheduleBody = z.object({
  classTypeId: z.number().int().positive(),
  branchId: z.number().int().positive(),
  trainerId: z.number().int().positive().nullable(),
  weekday: z.number().int().min(1).max(7),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM'),
  durationMin: z.number().int().min(15).max(240),
  capacity: z.number().int().min(1).max(200),
  room: z.string().trim().min(1).max(40),
}).strict();

export const classRoutes = [
  route({
    method: 'get', path: '/classes/sessions', tag: 'Clases', summary: 'Calendario de clases (semana)', auth: 'any',
    query: z.object({ from: isoDate.optional(), to: isoDate.optional(), branchId: z.coerce.number().int().positive().optional() }).strict(),
    handler: ({ query, user }) => {
      const tz = getSettings().timezone;
      const from = query.from ?? todayLocal();
      const to = query.to ?? addDays(from, 6);
      if (to < from) throw new AppError(422, 'INVALID_RANGE', 'Rango de fechas inválido.');
      const rows = all<SessionRow>(
        `${SESSION_SQL} WHERE s.starts_at >= :from AND s.starts_at < :to ${query.branchId ? 'AND s.branch_id = :branch' : ''} ORDER BY s.starts_at`,
        { from: localDayRangeUtc(from, tz).from, to: localDayRangeUtc(to, tz).to, branch: query.branchId },
      );
      const mine = user.memberId
        ? all<ReservationRow>("SELECT * FROM reservations WHERE member_id = ? AND status IN ('booked','waitlist','attended','no_show')", [user.memberId])
        : [];
      return { from, to, items: rows.map((s) => sessionView(s, mine.find((r) => r.session_id === s.id))) };
    },
  }),
  route({
    method: 'get', path: '/classes/sessions/:id', tag: 'Clases', summary: 'Detalle de clase (con lista de asistentes para el personal)', auth: 'any',
    params: idParam,
    handler: ({ params, user }) => {
      const s = loadSession(params.id);
      const mine = user.memberId ? one<ReservationRow>("SELECT * FROM reservations WHERE session_id = ? AND member_id = ? AND status <> 'cancelled'", [s.id, user.memberId]) : undefined;
      const view = sessionView(s, mine);
      if (user.role === 'member') return view;
      const roster = all(
        `SELECT r.id, r.status, r.waitlist_at, r.promoted_at, r.late_cancel, r.cancelled_at, m.id member_id, m.first_name || ' ' || m.last_name full_name
         FROM reservations r JOIN members m ON m.id = r.member_id WHERE r.session_id = ?
         ORDER BY CASE r.status WHEN 'attended' THEN 0 WHEN 'booked' THEN 1 WHEN 'no_show' THEN 2 WHEN 'waitlist' THEN 3 ELSE 4 END, r.waitlist_at, r.created_at`, [s.id],
      );
      return { ...view, roster };
    },
  }),
  route({
    method: 'post', path: '/classes/sessions/:id/book', tag: 'Clases', summary: 'Reservar (o entrar a la lista de espera si está llena)', status: 201, auth: ['member', 'reception', 'admin'],
    params: idParam,
    body: z.object({ memberId: z.number().int().positive().optional() }).strict(),
    handler: ({ params, body, user }) => {
      const memberId = user.role === 'member' ? user.memberId! : body.memberId;
      if (!memberId) throw unprocessable('MEMBER_REQUIRED', 'Selecciona el socio.');
      return book(params.id, memberId, user);
    },
  }),
  route({
    method: 'post', path: '/reservations/:id/cancel', tag: 'Clases', summary: 'Cancelar reserva (promueve automáticamente la lista de espera)', auth: ['member', 'reception', 'admin'],
    description: 'El socio puede cancelar hasta `cancel_min_hours` antes (configurable). Recepción puede cancelar después, quedando marcada como tardía.',
    params: idParam,
    handler: ({ params, user, ip }) => cancelReservation(params.id, user, ip),
  }),
  route({
    method: 'post', path: '/reservations/:id/attendance', tag: 'Clases', summary: 'Marcar asistencia', auth: ['trainer', 'reception', 'admin'],
    params: idParam,
    body: z.object({ status: z.enum(['attended', 'no_show', 'booked']) }).strict(),
    handler: ({ params, body, user }) => {
      const r = one<ReservationRow>('SELECT * FROM reservations WHERE id = ?', [params.id]);
      if (!r) throw notFound('La reserva');
      if (!['booked', 'attended', 'no_show'].includes(r.status)) throw conflict('NOT_BOOKED', 'Solo se marca asistencia a reservas confirmadas.');
      const s = loadSession(r.session_id);
      if (user.role === 'trainer' && s.trainer_id !== user.id) throw forbidden('Solo puedes marcar asistencia en tus clases.');
      run('UPDATE reservations SET status = ? WHERE id = ?', [body.status, r.id]);
      return { ok: true };
    },
  }),
  route({
    method: 'get', path: '/me/reservations', tag: 'Clases', summary: 'Mis reservas', auth: ['member'],
    query: z.object({ scope: z.enum(['upcoming', 'past']).default('upcoming') }).strict(),
    handler: ({ user, query }) => {
      const now = clock.now().toISOString();
      const rows = all<SessionRow & { reservation_id: number; reservation_status: string; waitlist_at: string | null; member_id: number; session_id: number }>(
        `SELECT s.*, ct.name class_name, ct.intensity, b.name branch_name, u.full_name trainer_name, 0 booked, 0 waitlist,
           r.id reservation_id, r.status reservation_status, r.waitlist_at, r.member_id, r.session_id
         FROM reservations r JOIN class_sessions s ON s.id = r.session_id JOIN class_types ct ON ct.id = s.class_type_id
         JOIN branches b ON b.id = s.branch_id LEFT JOIN users u ON u.id = s.trainer_id
         WHERE r.member_id = ? AND ${query.scope === 'upcoming' ? "s.starts_at > ? AND r.status IN ('booked','waitlist')" : 's.starts_at <= ?'}
         ORDER BY s.starts_at ${query.scope === 'upcoming' ? 'ASC' : 'DESC'} LIMIT 50`, [user.memberId, now],
      );
      return rows.map((r) => ({
        reservationId: r.reservation_id, status: r.reservation_status, className: r.class_name, startsAt: r.starts_at, endsAt: r.ends_at,
        room: r.room, trainerName: r.trainer_name, branchName: r.branch_name, sessionStatus: r.status,
        waitlistPosition: waitlistPosition({ id: r.reservation_id, session_id: r.session_id, status: r.reservation_status, waitlist_at: r.waitlist_at } as ReservationRow),
      }));
    },
  }),
  route({
    method: 'post', path: '/classes/sessions/:id/cancel', tag: 'Clases', summary: 'Cancelar clase y avisar a los inscritos', auth: ['trainer', 'admin'],
    params: idParam,
    body: z.object({ reason: z.string().trim().min(5, 'Explica brevemente el motivo').max(200) }).strict(),
    handler: ({ params, body, user, ip }) => cancelSession(params.id, body.reason, user, ip),
  }),
  route({
    method: 'patch', path: '/classes/sessions/:id', tag: 'Clases', summary: 'Ajustar cupo, sala o entrenador de una sesión', auth: ['admin'],
    params: idParam,
    body: z.object({
      capacity: z.number().int().min(1).max(200).optional(),
      room: z.string().trim().min(1).max(40).optional(),
      trainerId: z.number().int().positive().nullable().optional(),
    }).strict(),
    handler: ({ params, body, user, ip }) => tx(() => {
      const s = loadSession(params.id);
      if (body.capacity !== undefined && body.capacity < s.booked) {
        throw conflict('CAPACITY_BELOW_BOOKED', `Ya hay ${s.booked} reservas confirmadas; el cupo no puede ser menor.`);
      }
      run('UPDATE class_sessions SET capacity = COALESCE(:capacity, capacity), room = COALESCE(:room, room), trainer_id = CASE WHEN :setTrainer THEN :trainer ELSE trainer_id END WHERE id = :id',
        { capacity: body.capacity, room: body.room, setTrainer: body.trainerId !== undefined, trainer: body.trainerId ?? null, id: s.id });
      audit(user, 'class.update', 'class_session', s.id, body, ip);
      const promoted = promoteWaitlist(s.id);
      return { session: sessionView(loadSession(s.id)), promotedMemberIds: promoted };
    }),
  }),
  // --------------------------------------------------------- administración del horario
  route({
    method: 'get', path: '/admin/class-types', tag: 'Clases', summary: 'Tipos de clase', auth: ['admin', 'trainer', 'reception'],
    handler: () => all('SELECT * FROM class_types ORDER BY name'),
  }),
  route({
    method: 'post', path: '/admin/class-types', tag: 'Clases', summary: 'Crear tipo de clase', status: 201, auth: ['admin'],
    body: z.object({ name: z.string().trim().min(2).max(40), description: z.string().trim().max(300).default(''), intensity: z.number().int().min(1).max(3) }).strict(),
    handler: ({ body }) => one('SELECT * FROM class_types WHERE id = ?', [insert('INSERT INTO class_types (name, description, intensity) VALUES (?, ?, ?)', [body.name, body.description, body.intensity])]),
  }),
  route({
    method: 'get', path: '/admin/schedules', tag: 'Clases', summary: 'Horario semanal', auth: ['admin'],
    handler: () => all(
      `SELECT sc.*, ct.name class_name, b.name branch_name, u.full_name trainer_name FROM class_schedules sc
       JOIN class_types ct ON ct.id = sc.class_type_id JOIN branches b ON b.id = sc.branch_id LEFT JOIN users u ON u.id = sc.trainer_id
       ORDER BY sc.active DESC, sc.weekday, sc.start_time`,
    ),
  }),
  route({
    method: 'post', path: '/admin/schedules', tag: 'Clases', summary: 'Agregar clase al horario semanal', status: 201, auth: ['admin'],
    body: scheduleBody,
    handler: ({ body, user, ip }) => tx(() => {
      const id = insert(
        'INSERT INTO class_schedules (class_type_id, branch_id, trainer_id, weekday, start_time, duration_min, capacity, room) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [body.classTypeId, body.branchId, body.trainerId, body.weekday, body.startTime, body.durationMin, body.capacity, body.room],
      );
      audit(user, 'schedule.create', 'class_schedule', id, body, ip);
      const created = generateSessions(todayLocal(), 14);
      return { id, sessionsCreated: created };
    }),
  }),
  route({
    method: 'patch', path: '/admin/schedules/:id', tag: 'Clases', summary: 'Activar o desactivar una clase del horario', auth: ['admin'],
    description: 'Desactivar no borra sesiones ya generadas con reservas; esas se cancelan individualmente para avisar a los socios.',
    params: idParam,
    body: z.object({ active: z.boolean() }).strict(),
    handler: ({ params, body, user, ip }) => {
      if (!run('UPDATE class_schedules SET active = ? WHERE id = ?', [body.active, params.id]).changes) throw notFound('El horario');
      if (!body.active) {
        // Elimina sesiones futuras sin reservas; las que tienen reservas quedan para cancelarse con aviso.
        run(`DELETE FROM class_sessions WHERE schedule_id = ? AND starts_at > ? AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.session_id = class_sessions.id)`,
          [params.id, clock.now().toISOString()]);
      } else generateSessions(todayLocal(), 14);
      audit(user, 'schedule.toggle', 'class_schedule', params.id, body, ip);
      return { ok: true };
    },
  }),
];

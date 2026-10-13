import { z } from 'zod';
import { all, insert, one, run, tx } from '../db/db.ts';
import { route, idParam, isoDate, type AuthUser } from '../lib/http.ts';
import { conflict, forbidden, notFound } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { clock } from '../lib/clock.ts';
import { getSettings } from '../lib/settings.ts';
import { maskDni } from '../lib/format.ts';
import { hashPassword } from '../lib/crypto.ts';
import { localDayRangeUtc, addDays } from '../lib/dates.ts';
import { randomInt } from 'node:crypto';
import { assertMemberAccess, canAccessMember } from './access-control.ts';
import { memberMemberships, pickCurrent, todayLocal, viewMembership, type MembershipFull } from './memberships.ts';
import { memberDebt } from './payments.ts';
import { notify } from './notifications.ts';

interface MemberRow {
  id: number; user_id: number | null; dni: string; first_name: string; last_name: string; email: string | null; phone: string | null;
  birth_date: string | null; health_notes: string | null; emergency_contact: string | null; trainer_id: number | null;
  home_branch_id: number | null; created_at: string; trainer_name?: string | null; account_email?: string | null;
}

const docId = z.string().trim().toUpperCase().regex(/^[0-9A-Z]{8,12}$/, 'DNI o CE: 8 a 12 caracteres, solo números y letras');
const phone = z.string().trim().regex(/^\+?[0-9 ]{6,16}$/, 'Teléfono inválido');
const name = z.string().trim().min(2).max(60);

/** Construye la vista del socio aplicando visibilidad de datos personales por rol y registra la consulta. */
function memberView(m: MemberRow, user: AuthUser, ip?: string) {
  const self = user.role === 'member' && user.memberId === m.id;
  const seeDni = self || user.role === 'admin' || user.role === 'reception';
  const seeHealth = canAccessMember(user, m.id, 'health');
  const seePersonal = self || user.role === 'admin' || seeHealth;
  if (!self) {
    const fields = [seeDni && 'dni', seeHealth && m.health_notes && 'health_notes', seePersonal && 'birth_date'].filter(Boolean);
    if (fields.length) audit(user, 'pii.view', 'member', m.id, { fields }, ip);
  }
  return {
    id: m.id,
    firstName: m.first_name,
    lastName: m.last_name,
    fullName: `${m.first_name} ${m.last_name}`,
    dni: seeDni ? m.dni : maskDni(m.dni),
    dniMasked: !seeDni,
    email: m.email,
    phone: m.phone,
    birthDate: seePersonal ? m.birth_date : null,
    emergencyContact: m.emergency_contact,
    healthNotes: seeHealth ? m.health_notes : null,
    healthRestricted: !seeHealth,
    trainerId: m.trainer_id,
    trainerName: m.trainer_name ?? null,
    homeBranchId: m.home_branch_id,
    hasAccount: !!m.user_id,
    createdAt: m.created_at,
  };
}

function loadMember(id: number): MemberRow {
  const m = one<MemberRow>(
    `SELECT m.*, t.full_name trainer_name, u.email account_email FROM members m
     LEFT JOIN users t ON t.id = m.trainer_id LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?`, [id],
  );
  if (!m) throw notFound('El socio');
  return m;
}

function tempPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const pick = (n: number) => Array.from({ length: n }, () => letters[randomInt(letters.length)]).join('');
  return `${pick(4)}-${randomInt(1000, 9999)}-${pick(4)}`;
}

async function createAccount(memberId: number, email: string, fullName: string, branchId: number | null) {
  const password = tempPassword();
  const hash = await hashPassword(password);
  return tx(() => {
    const m = one<{ user_id: number | null }>('SELECT user_id FROM members WHERE id = ?', [memberId]);
    if (m?.user_id) throw conflict('ACCOUNT_EXISTS', 'El socio ya tiene una cuenta.');
    const uid = insert('INSERT INTO users (email, password_hash, role, full_name, branch_id) VALUES (?, ?, ?, ?, ?)',
      [email.toLowerCase(), hash, 'member', fullName, branchId]);
    run('UPDATE members SET user_id = ? WHERE id = ?', [uid, memberId]);
    return password;
  });
}

/** Lista con estado del plan calculado (un único barrido de membresías activas). */
function listMembers(user: AuthUser, q: string | undefined, status: string | undefined, limit: number) {
  const where: string[] = [];
  const params: Record<string, string | number | null> = {};
  if (q) {
    where.push(`(m.first_name || ' ' || m.last_name LIKE :like OR m.last_name LIKE :like OR m.dni LIKE :dni OR m.email LIKE :like OR m.phone LIKE :like)`);
    params.like = `%${q}%`;
    params.dni = `${q.toUpperCase()}%`;
  }
  if (user.role === 'trainer') { where.push('m.trainer_id = :trainer'); params.trainer = user.id; }
  const rows = all<MemberRow>(
    `SELECT m.*, t.full_name trainer_name FROM members m LEFT JOIN users t ON t.id = m.trainer_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.last_name, m.first_name`, params,
  );
  const ids = rows.map((r) => r.id);
  const memberships = ids.length
    ? all<Omit<MembershipFull, 'freezes'>>(
      `SELECT ms.*, p.name plan_name, p.includes_classes, p.max_freeze_days, p.duration_days, p.active plan_active, p.price_cents plan_price_cents,
        (SELECT IFNULL(SUM(amount_cents),0) FROM payments WHERE membership_id = ms.id AND status = 'valid') paid_cents
       FROM memberships ms JOIN plans p ON p.id = ms.plan_id WHERE ms.status = 'active'`)
    : [];
  const freezes = all<{ membership_id: number; start_date: string; end_date: string }>('SELECT membership_id, start_date, end_date FROM membership_freezes');
  const lastVisit = new Map(all<{ member_id: number; last: string }>(
    "SELECT member_id, MAX(checked_in_at) last FROM visits WHERE result = 'granted' GROUP BY member_id").map((r) => [r.member_id, r.last]));
  const debts = new Map(all<{ member_id: number; debt: number }>(
    `SELECT ms.member_id, SUM(MAX(0, ms.amount_due_cents - (SELECT IFNULL(SUM(amount_cents),0) FROM payments WHERE membership_id = ms.id AND status = 'valid'))) debt
     FROM memberships ms WHERE ms.status IN ('active','replaced') GROUP BY ms.member_id`).map((r) => [r.member_id, r.debt]));
  const today = todayLocal();
  const out = rows.map((m) => {
    const mine = memberships.filter((x) => x.member_id === m.id)
      .map((x) => ({ ...x, freezes: freezes.filter((f) => f.membership_id === x.id) })) as MembershipFull[];
    const cur = pickCurrent(mine, today);
    const v = cur ? viewMembership(cur, today) : null;
    return {
      id: m.id, fullName: `${m.first_name} ${m.last_name}`, firstName: m.first_name, lastName: m.last_name,
      dni: maskDni(m.dni), phone: m.phone, email: m.email, trainerName: m.trainer_name ?? null,
      state: v?.state ?? 'none', planName: v?.planName ?? null, endDate: v?.endDate ?? null, daysLeft: v?.daysLeft ?? null,
      debtCents: debts.get(m.id) ?? 0, lastVisit: lastVisit.get(m.id) ?? null,
    };
  });
  const filtered = status ? out.filter((m) => (status === 'debt' ? m.debtCents > 0 : m.state === status)) : out;
  const counts = out.reduce<Record<string, number>>((acc, m) => { acc[m.state] = (acc[m.state] ?? 0) + 1; return acc; }, {});
  counts.debt = out.filter((m) => m.debtCents > 0).length;
  return { items: filtered.slice(0, limit), total: filtered.length, counts };
}

export const memberRoutes = [
  route({
    method: 'get', path: '/members', tag: 'Socios', summary: 'Buscar socios', auth: ['reception', 'trainer', 'admin'],
    description: 'Búsqueda por nombre, DNI (prefijo), correo o teléfono. El DNI se devuelve enmascarado. Entrenadores ven solo a sus socios asignados.',
    query: z.object({
      q: z.string().trim().max(60).optional(),
      status: z.enum(['active', 'expiring', 'expires_today', 'expired', 'frozen', 'not_started', 'none', 'debt']).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }).strict(),
    handler: ({ query, user }) => listMembers(user, query.q || undefined, query.status, query.limit),
  }),
  route({
    method: 'post', path: '/members', tag: 'Socios', summary: 'Alta rápida de socio', status: 201, auth: ['reception', 'admin'],
    description: 'Si `createAccount` es verdadero se crea el acceso a la app y se devuelve una contraseña temporal que se muestra una sola vez.',
    body: z.object({
      dni: docId,
      firstName: name,
      lastName: name,
      phone: phone.optional().nullable(),
      email: z.email('Correo inválido').max(120).optional().nullable(),
      birthDate: isoDate.optional().nullable(),
      emergencyContact: z.string().trim().max(120).optional().nullable(),
      healthNotes: z.string().trim().max(1000).optional().nullable(),
      trainerId: z.number().int().positive().optional().nullable(),
      createAccount: z.boolean().default(false),
    }).strict()
      .refine((b) => !b.createAccount || !!b.email, { message: 'Para crear la cuenta se necesita un correo', path: ['email'] }),
    handler: async ({ body, user, ip }) => {
      if (one('SELECT id FROM members WHERE dni = ?', [body.dni])) throw conflict('DNI_TAKEN', 'Ya existe un socio con ese DNI.');
      if (body.trainerId && !one("SELECT id FROM users WHERE id = ? AND role = 'trainer' AND active = 1", [body.trainerId])) throw notFound('El entrenador');
      const id = insert(
        `INSERT INTO members (dni, first_name, last_name, email, phone, birth_date, health_notes, emergency_contact, trainer_id, home_branch_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [body.dni, body.firstName, body.lastName, body.email?.toLowerCase() ?? null, body.phone ?? null, body.birthDate ?? null,
          body.healthNotes ?? null, body.emergencyContact ?? null, body.trainerId ?? null, user.branchId, user.id, clock.now().toISOString()],
      );
      audit(user, 'member.create', 'member', id, {}, ip);
      let temporaryPassword: string | null = null;
      if (body.createAccount && body.email) {
        temporaryPassword = await createAccount(id, body.email, `${body.firstName} ${body.lastName}`, user.branchId);
      }
      notify(id, 'welcome', {}, `welcome:${id}`);
      return { member: memberView(loadMember(id), user), temporaryPassword };
    },
  }),
  route({
    method: 'get', path: '/members/:id', tag: 'Socios', summary: 'Ficha del socio', auth: 'any',
    description: 'DNI completo: recepción y admin. Notas de salud: entrenador asignado y admin. Cada consulta de datos personales queda auditada.',
    params: idParam,
    handler: ({ params, user, ip }) => {
      assertMemberAccess(user, params.id, 'basic');
      const m = loadMember(params.id);
      const today = todayLocal();
      const memberships = memberMemberships(m.id);
      const cur = pickCurrent(memberships, today);
      const canFinance = canAccessMember(user, m.id, 'finance');
      const { from } = localDayRangeUtc(addDays(today, -29), getSettings().timezone);
      const visits30 = one<{ n: number }>("SELECT COUNT(*) n FROM visits WHERE member_id = ? AND result = 'granted' AND checked_in_at >= ?", [m.id, from])!.n;
      return {
        member: memberView(m, user, ip),
        membership: cur ? viewMembership(cur, today) : null,
        debt: canFinance ? memberDebt(m.id) : null,
        stats: { visitsLast30: visits30 },
      };
    },
  }),
  route({
    method: 'patch', path: '/members/:id', tag: 'Socios', summary: 'Actualizar datos del socio', auth: 'any',
    params: idParam,
    body: z.object({
      firstName: name.optional(),
      lastName: name.optional(),
      phone: phone.nullable().optional(),
      email: z.email().max(120).nullable().optional(),
      birthDate: isoDate.nullable().optional(),
      emergencyContact: z.string().trim().max(120).nullable().optional(),
      healthNotes: z.string().trim().max(1000).nullable().optional(),
    }).strict(),
    handler: ({ params, body, user, ip }) => {
      assertMemberAccess(user, params.id, 'basic');
      if (user.role === 'trainer' && Object.keys(body).some((k) => k !== 'healthNotes')) {
        throw forbidden('Como entrenador solo puedes actualizar las notas de salud.');
      }
      if (body.healthNotes !== undefined && !canAccessMember(user, params.id, 'health')) throw forbidden('No puedes editar datos de salud.');
      const map: Record<string, string> = {
        firstName: 'first_name', lastName: 'last_name', phone: 'phone', email: 'email', birthDate: 'birth_date',
        emergencyContact: 'emergency_contact', healthNotes: 'health_notes',
      };
      const entries = Object.entries(body).filter(([, v]) => v !== undefined);
      if (entries.length) {
        run(`UPDATE members SET ${entries.map(([k]) => `${map[k]} = :${k}`).join(', ')} WHERE id = :id`,
          { ...Object.fromEntries(entries), id: params.id } as Record<string, string | null | number>);
        audit(user, 'member.update', 'member', params.id, { fields: entries.map(([k]) => k) }, ip);
      }
      return memberView(loadMember(params.id), user, ip);
    },
  }),
  route({
    method: 'put', path: '/members/:id/trainer', tag: 'Socios', summary: 'Asignar entrenador', auth: ['reception', 'admin'],
    params: idParam,
    body: z.object({ trainerId: z.number().int().positive().nullable() }).strict(),
    handler: ({ params, body, user, ip }) => {
      loadMember(params.id);
      if (body.trainerId && !one("SELECT id FROM users WHERE id = ? AND role = 'trainer' AND active = 1", [body.trainerId])) throw notFound('El entrenador');
      run('UPDATE members SET trainer_id = ? WHERE id = ?', [body.trainerId, params.id]);
      audit(user, 'member.assign_trainer', 'member', params.id, { trainer_id: body.trainerId }, ip);
      return { ok: true };
    },
  }),
  route({
    method: 'post', path: '/members/:id/account', tag: 'Socios', summary: 'Crear acceso a la app para el socio', status: 201, auth: ['reception', 'admin'],
    params: idParam,
    handler: async ({ params, user, ip }) => {
      const m = loadMember(params.id);
      if (!m.email) throw conflict('EMAIL_REQUIRED', 'Registra primero un correo para el socio.');
      const temporaryPassword = await createAccount(m.id, m.email, `${m.first_name} ${m.last_name}`, m.home_branch_id);
      audit(user, 'member.account_created', 'member', m.id, {}, ip);
      return { temporaryPassword };
    },
  }),
  route({
    method: 'get', path: '/me', tag: 'Socios', summary: 'Inicio del socio: plan, deuda, próximas clases', auth: ['member'],
    handler: ({ user }) => {
      const id = user.memberId!;
      const m = loadMember(id);
      const today = todayLocal();
      const cur = pickCurrent(memberMemberships(id), today);
      const tz = getSettings().timezone;
      const monthStart = localDayRangeUtc(`${today.slice(0, 7)}-01`, tz).from;
      const visitsMonth = one<{ n: number }>("SELECT COUNT(*) n FROM visits WHERE member_id = ? AND result = 'granted' AND checked_in_at >= ?", [id, monthStart])!.n;
      const lastVisit = one<{ t: string | null }>("SELECT MAX(checked_in_at) t FROM visits WHERE member_id = ? AND result = 'granted'", [id])!.t;
      const nextClasses = all(
        `SELECT r.id reservation_id, r.status, s.id session_id, s.starts_at, s.ends_at, s.room, ct.name class_name, u.full_name trainer_name
         FROM reservations r JOIN class_sessions s ON s.id = r.session_id JOIN class_types ct ON ct.id = s.class_type_id
         LEFT JOIN users u ON u.id = s.trainer_id
         WHERE r.member_id = ? AND r.status IN ('booked','waitlist') AND s.status = 'scheduled' AND s.starts_at > ?
         ORDER BY s.starts_at LIMIT 3`, [id, clock.now().toISOString()],
      );
      const unread = one<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE member_id = ? AND read_at IS NULL', [id])!.n;
      return {
        member: { id: m.id, firstName: m.first_name, lastName: m.last_name, trainerName: m.trainer_name ?? null },
        membership: cur ? viewMembership(cur, today) : null,
        debt: memberDebt(id),
        stats: { visitsThisMonth: visitsMonth, lastVisit },
        nextClasses,
        unreadNotifications: unread,
        today,
      };
    },
  }),
];

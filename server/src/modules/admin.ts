import { z } from 'zod';
import { all, insert, one, run } from '../db/db.ts';
import { route, idParam, type Role } from '../lib/http.ts';
import { conflict, notFound, unprocessable } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { getSettings, saveSettings, settingsSchema } from '../lib/settings.ts';
import { hashPassword } from '../lib/crypto.ts';
import { randomInt } from 'node:crypto';
import { revokeAllSessions, passwordSchema } from './auth.ts';

const STAFF_ROLES = ['reception', 'trainer', 'admin'] as const;
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM');

function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz';
  return Array.from({ length: 5 }, () => abc[randomInt(abc.length)]).join('') + '-' + randomInt(10000, 99999);
}

const planBody = z.object({
  name: z.string().trim().min(3).max(40),
  description: z.string().trim().max(300).default(''),
  durationDays: z.number().int().min(1).max(730),
  priceCents: z.number().int().min(0).max(10_000_000),
  includesClasses: z.boolean().default(true),
  maxFreezeDays: z.number().int().min(0).max(180).default(0),
}).strict();

const branchBody = z.object({
  name: z.string().trim().min(3).max(60),
  address: z.string().trim().max(160).default(''),
  opensAt: time,
  closesAt: time,
  capacity: z.number().int().min(1).max(5000),
}).strict();

export const adminRoutes = [
  // ---------------------------------------------------------------- planes
  route({
    method: 'post', path: '/admin/plans', tag: 'Administración', summary: 'Crear plan', status: 201, auth: ['admin'],
    body: planBody,
    handler: ({ body, user, ip }) => {
      const id = insert('INSERT INTO plans (name, description, duration_days, price_cents, includes_classes, max_freeze_days) VALUES (?, ?, ?, ?, ?, ?)',
        [body.name, body.description, body.durationDays, body.priceCents, body.includesClasses, body.maxFreezeDays]);
      audit(user, 'plan.create', 'plan', id, body, ip);
      return one('SELECT * FROM plans WHERE id = ?', [id]);
    },
  }),
  route({
    method: 'patch', path: '/admin/plans/:id', tag: 'Administración', summary: 'Editar plan (el precio nuevo aplica solo a ventas futuras)', auth: ['admin'],
    params: idParam,
    body: planBody.partial().extend({ active: z.boolean().optional() }).strict(),
    handler: ({ params, body, user, ip }) => {
      const before = one<Record<string, unknown>>('SELECT * FROM plans WHERE id = ?', [params.id]);
      if (!before) throw notFound('El plan');
      const map: Record<string, string> = {
        name: 'name', description: 'description', durationDays: 'duration_days', priceCents: 'price_cents',
        includesClasses: 'includes_classes', maxFreezeDays: 'max_freeze_days', active: 'active',
      };
      const entries = Object.entries(body).filter(([, v]) => v !== undefined);
      if (entries.length) {
        run(`UPDATE plans SET ${entries.map(([k]) => `${map[k]} = :${k}`).join(', ')} WHERE id = :id`, { ...Object.fromEntries(entries), id: params.id } as Record<string, string | number | boolean>);
        audit(user, 'plan.update', 'plan', params.id, { before, changes: body }, ip);
      }
      return one('SELECT * FROM plans WHERE id = ?', [params.id]);
    },
  }),
  // ----------------------------------------------------------------- sedes
  route({
    method: 'get', path: '/branches', tag: 'Administración', summary: 'Sedes', auth: 'any',
    handler: () => all('SELECT * FROM branches ORDER BY active DESC, name'),
  }),
  route({
    method: 'post', path: '/admin/branches', tag: 'Administración', summary: 'Crear sede', status: 201, auth: ['admin'],
    body: branchBody,
    handler: ({ body, user, ip }) => {
      const id = insert('INSERT INTO branches (name, address, opens_at, closes_at, capacity) VALUES (?, ?, ?, ?, ?)',
        [body.name, body.address, body.opensAt, body.closesAt, body.capacity]);
      audit(user, 'branch.create', 'branch', id, body, ip);
      return one('SELECT * FROM branches WHERE id = ?', [id]);
    },
  }),
  route({
    method: 'patch', path: '/admin/branches/:id', tag: 'Administración', summary: 'Editar sede', auth: ['admin'],
    params: idParam,
    body: branchBody.partial().extend({ active: z.boolean().optional() }).strict(),
    handler: ({ params, body, user, ip }) => {
      if (!one('SELECT id FROM branches WHERE id = ?', [params.id])) throw notFound('La sede');
      const map: Record<string, string> = { name: 'name', address: 'address', opensAt: 'opens_at', closesAt: 'closes_at', capacity: 'capacity', active: 'active' };
      const entries = Object.entries(body).filter(([, v]) => v !== undefined);
      if (entries.length) {
        run(`UPDATE branches SET ${entries.map(([k]) => `${map[k]} = :${k}`).join(', ')} WHERE id = :id`, { ...Object.fromEntries(entries), id: params.id } as Record<string, string | number | boolean>);
        audit(user, 'branch.update', 'branch', params.id, body, ip);
      }
      return one('SELECT * FROM branches WHERE id = ?', [params.id]);
    },
  }),
  // ---------------------------------------------------------------- personal
  route({
    method: 'get', path: '/admin/staff', tag: 'Administración', summary: 'Personal', auth: ['admin', 'reception'],
    query: z.object({ role: z.enum(STAFF_ROLES).optional() }).strict(),
    handler: ({ query }) => all(
      `SELECT u.id, u.email, u.role, u.full_name, u.phone, u.branch_id, b.name branch_name, u.active, u.created_at,
         (SELECT COUNT(*) FROM members m WHERE m.trainer_id = u.id) assigned_members
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.role <> 'member' ${query.role ? 'AND u.role = :role' : ''} ORDER BY u.active DESC, u.role, u.full_name`,
      { role: query.role },
    ).map((u) => ({ ...(u as object), active: !!(u as { active: number }).active })),
  }),
  route({
    method: 'post', path: '/admin/staff', tag: 'Administración', summary: 'Dar de alta personal', status: 201, auth: ['admin'],
    description: 'Si no se envía contraseña se genera una temporal que se muestra una sola vez.',
    body: z.object({
      email: z.email().max(120),
      fullName: z.string().trim().min(3).max(80),
      role: z.enum(STAFF_ROLES),
      branchId: z.number().int().positive().nullable(),
      phone: z.string().trim().regex(/^\+?[0-9 ]{6,16}$/).nullable().optional(),
      password: passwordSchema.optional(),
    }).strict(),
    handler: async ({ body, user, ip }) => {
      if (one('SELECT id FROM users WHERE email = ?', [body.email])) throw conflict('EMAIL_TAKEN', 'Ese correo ya está registrado.');
      const password = body.password ?? tempPassword();
      const id = insert('INSERT INTO users (email, password_hash, role, full_name, branch_id, phone) VALUES (?, ?, ?, ?, ?, ?)',
        [body.email.toLowerCase(), await hashPassword(password), body.role, body.fullName, body.branchId, body.phone ?? null]);
      audit(user, 'staff.create', 'user', id, { role: body.role }, ip);
      return { id, temporaryPassword: body.password ? null : password };
    },
  }),
  route({
    method: 'patch', path: '/admin/staff/:id', tag: 'Administración', summary: 'Editar o desactivar personal', auth: ['admin'],
    params: idParam,
    body: z.object({
      fullName: z.string().trim().min(3).max(80).optional(),
      role: z.enum(STAFF_ROLES).optional(),
      branchId: z.number().int().positive().nullable().optional(),
      active: z.boolean().optional(),
    }).strict(),
    handler: ({ params, body, user, ip }) => {
      const target = one<{ id: number; role: Role }>('SELECT id, role FROM users WHERE id = ?', [params.id]);
      if (!target || target.role === 'member') throw notFound('El miembro del personal');
      if (target.id === user.id && (body.active === false || (body.role && body.role !== 'admin'))) {
        throw unprocessable('SELF_LOCKOUT', 'No puedes desactivarte ni quitarte el rol de administrador.');
      }
      run(`UPDATE users SET full_name = COALESCE(:fullName, full_name), role = COALESCE(:role, role),
           branch_id = CASE WHEN :setBranch THEN :branchId ELSE branch_id END, active = COALESCE(:active, active) WHERE id = :id`,
        { fullName: body.fullName, role: body.role, setBranch: body.branchId !== undefined, branchId: body.branchId ?? null, active: body.active, id: params.id });
      if (body.active === false || body.role) revokeAllSessions(params.id);
      audit(user, 'staff.update', 'user', params.id, body, ip);
      return { ok: true };
    },
  }),
  // ----------------------------------------------------------- configuración
  route({
    method: 'get', path: '/settings', tag: 'Administración', summary: 'Configuración del negocio', auth: 'any',
    handler: () => getSettings(),
  }),
  route({
    method: 'put', path: '/admin/settings', tag: 'Administración', summary: 'Actualizar configuración', auth: ['admin'],
    body: settingsSchema.partial().strict(),
    handler: ({ body, user, ip }) => {
      const before = getSettings();
      const next = saveSettings(body, user.id);
      audit(user, 'settings.update', 'settings', null, { before: Object.fromEntries(Object.keys(body).map((k) => [k, before[k as keyof typeof before]])), after: body }, ip);
      return next;
    },
  }),
  // ------------------------------------------------------------- auditoría
  route({
    method: 'get', path: '/admin/audit', tag: 'Administración', summary: 'Registro de auditoría (incluye consultas de datos personales)', auth: ['admin'],
    query: z.object({
      action: z.string().max(60).optional(),
      entity: z.string().max(40).optional(),
      entityId: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(500).default(150),
    }).strict(),
    handler: ({ query }) => all(
      `SELECT a.*, u.full_name actor_name, u.role actor_role FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       WHERE 1=1 ${query.action ? 'AND a.action LIKE :action' : ''} ${query.entity ? 'AND a.entity = :entity' : ''} ${query.entityId ? 'AND a.entity_id = :entityId' : ''}
       ORDER BY a.id DESC LIMIT :limit`,
      { action: query.action ? `${query.action}%` : undefined, entity: query.entity, entityId: query.entityId, limit: query.limit },
    ).map((r) => ({ ...(r as object), details: JSON.parse((r as { details: string }).details) })),
  }),
];

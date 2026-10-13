import { z } from 'zod';
import { all, one, run } from '../db/db.ts';
import { route } from '../lib/http.ts';
import { getSettings } from '../lib/settings.ts';
import { notFound } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { config } from '../config.ts';
import { clock } from '../lib/clock.ts';

export const TEMPLATE_KEYS = [
  'welcome', 'membership_expiring', 'membership_expires_today', 'membership_expired',
  'class_cancelled', 'waitlist_promoted', 'payment_received', 'payment_voided',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const TEMPLATE_VARIABLES: Record<TemplateKey, string[]> = {
  welcome: ['nombre', 'gimnasio'],
  membership_expiring: ['nombre', 'plan', 'fecha', 'dias', 'gimnasio'],
  membership_expires_today: ['nombre', 'plan', 'gimnasio'],
  membership_expired: ['nombre', 'plan', 'fecha', 'gimnasio'],
  class_cancelled: ['nombre', 'clase', 'fecha', 'hora', 'motivo', 'gimnasio'],
  waitlist_promoted: ['nombre', 'clase', 'fecha', 'hora', 'gimnasio'],
  payment_received: ['nombre', 'monto', 'comprobante', 'gimnasio'],
  payment_voided: ['nombre', 'monto', 'comprobante', 'motivo', 'gimnasio'],
};

export const DEFAULT_TEMPLATES: Record<TemplateKey, { name: string; subject: string; body: string }> = {
  welcome: {
    name: 'Bienvenida',
    subject: 'Te damos la bienvenida a {{gimnasio}}',
    body: 'Hola {{nombre}}, ya eres parte de {{gimnasio}}. Desde la app puedes ver tu plan, reservar clases y mostrar tu pase de ingreso.',
  },
  membership_expiring: {
    name: 'Plan por vencer',
    subject: 'Tu plan vence en {{dias}} días',
    body: 'Hola {{nombre}}, tu plan {{plan}} vence el {{fecha}}. Renuévalo en recepción para no perder tu continuidad.',
  },
  membership_expires_today: {
    name: 'Plan vence hoy',
    subject: 'Hoy es el último día de tu plan',
    body: 'Hola {{nombre}}, hoy vence tu plan {{plan}}. Hoy todavía puedes entrenar; renueva para seguir mañana.',
  },
  membership_expired: {
    name: 'Plan vencido',
    subject: 'Tu plan venció',
    body: 'Hola {{nombre}}, tu plan {{plan}} venció el {{fecha}}. Te esperamos en recepción para renovarlo.',
  },
  class_cancelled: {
    name: 'Clase cancelada',
    subject: 'Cancelamos {{clase}} del {{fecha}}',
    body: 'Hola {{nombre}}, la clase {{clase}} del {{fecha}} a las {{hora}} fue cancelada. Motivo: {{motivo}}. Tu reserva quedó liberada.',
  },
  waitlist_promoted: {
    name: 'Cupo liberado',
    subject: 'Tienes cupo en {{clase}}',
    body: 'Hola {{nombre}}, se liberó un cupo y ya estás reservado en {{clase}} el {{fecha}} a las {{hora}}. Si no puedes ir, cancela para cederlo.',
  },
  payment_received: {
    name: 'Pago recibido',
    subject: 'Recibimos tu pago de {{monto}}',
    body: 'Hola {{nombre}}, registramos tu pago de {{monto}}. Comprobante {{comprobante}}. Puedes descargarlo desde la app.',
  },
  payment_voided: {
    name: 'Pago anulado',
    subject: 'Se anuló el comprobante {{comprobante}}',
    body: 'Hola {{nombre}}, el comprobante {{comprobante}} por {{monto}} fue anulado. Motivo: {{motivo}}. Si tienes dudas, acércate a recepción.',
  },
};

export function seedTemplates(): void {
  for (const key of TEMPLATE_KEYS) {
    const t = DEFAULT_TEMPLATES[key];
    run('INSERT OR IGNORE INTO notification_templates (key, name, subject, body) VALUES (?, ?, ?, ?)', [key, t.name, t.subject, t.body]);
  }
}

export function render(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => (k in vars ? String(vars[k]) : ''));
}

interface TemplateRow { key: string; name: string; subject: string; body: string; send_email: number; send_inapp: number }

/**
 * Crea la notificación in-app y encola el correo según la plantilla.
 * `dedupeKey` garantiza que un recordatorio no se envíe dos veces (índice UNIQUE).
 */
export function notify(memberId: number, key: TemplateKey, vars: Record<string, string | number>, dedupeKey?: string): boolean {
  const t = one<TemplateRow>('SELECT * FROM notification_templates WHERE key = ?', [key]) ?? {
    key, ...DEFAULT_TEMPLATES[key], send_email: 1, send_inapp: 1,
  };
  const member = one<{ first_name: string; email: string | null }>('SELECT first_name, email FROM members WHERE id = ?', [memberId]);
  if (!member) return false;
  const full = { nombre: member.first_name, gimnasio: getSettings().gym_name, ...vars };
  const title = render(t.subject, full);
  const body = render(t.body, full);
  let created = false;
  if (t.send_inapp) {
    created = run(
      'INSERT OR IGNORE INTO notifications (member_id, template_key, title, body, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [memberId, key, title, body, dedupeKey ?? null, clock.now().toISOString()],
    ).changes > 0;
  }
  if (t.send_email && member.email) {
    const r = run(
      'INSERT OR IGNORE INTO email_outbox (to_email, subject, body, template_key, dedupe_key) VALUES (?, ?, ?, ?, ?)',
      [member.email, title, body, key, dedupeKey ? `mail:${dedupeKey}` : null],
    );
    created ||= r.changes > 0;
  }
  return created;
}

/** Despacha la bandeja de salida. Transporte "log" (desarrollo) o "smtp" (requiere nodemailer). */
export async function deliverOutbox(limit = 50): Promise<number> {
  const pending = all<{ id: number; to_email: string; subject: string; body: string; attempts: number }>(
    "SELECT id, to_email, subject, body, attempts FROM email_outbox WHERE status = 'pending' AND attempts < 5 ORDER BY id LIMIT ?",
    [limit],
  );
  if (!pending.length) return 0;
  let send: (m: { to: string; subject: string; text: string }) => Promise<void>;
  if (config.mail.transport === 'smtp') {
    const mod = 'nodemailer';
    const nodemailer = await import(mod);
    const transporter = nodemailer.createTransport(config.mail.smtpUrl);
    send = async (m) => { await transporter.sendMail({ from: config.mail.from, ...m }); };
  } else {
    send = async (m) => { if (!config.isTest) console.info(`[correo] → ${m.to} · ${m.subject}`); };
  }
  let sent = 0;
  for (const m of pending) {
    try {
      await send({ to: m.to_email, subject: m.subject, text: m.body });
      run("UPDATE email_outbox SET status = 'sent', sent_at = ?, attempts = attempts + 1 WHERE id = ?", [clock.now().toISOString(), m.id]);
      sent++;
    } catch (err) {
      const failed = m.attempts + 1 >= 5;
      run('UPDATE email_outbox SET attempts = attempts + 1, last_error = ?, status = ? WHERE id = ?',
        [(err as Error).message.slice(0, 500), failed ? 'failed' : 'pending', m.id]);
    }
  }
  return sent;
}

// ------------------------------------------------------------------- rutas

export const notificationRoutes = [
  route({
    method: 'get', path: '/me/notifications', tag: 'Notificaciones', summary: 'Mis avisos (socio)', auth: ['member'],
    handler: ({ user }) => {
      const items = all('SELECT id, template_key, title, body, read_at, created_at FROM notifications WHERE member_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', [user.memberId]);
      const unread = one<{ n: number }>('SELECT COUNT(*) n FROM notifications WHERE member_id = ? AND read_at IS NULL', [user.memberId])!.n;
      return { items, unread };
    },
  }),
  route({
    method: 'post', path: '/me/notifications/read', tag: 'Notificaciones', summary: 'Marcar avisos como leídos', auth: ['member'],
    body: z.object({ ids: z.array(z.number().int().positive()).max(100).optional() }).strict(),
    handler: ({ user, body }) => {
      const now = clock.now().toISOString();
      if (body.ids?.length) {
        for (const id of body.ids) run('UPDATE notifications SET read_at = ? WHERE id = ? AND member_id = ? AND read_at IS NULL', [now, id, user.memberId]);
      } else {
        run('UPDATE notifications SET read_at = ? WHERE member_id = ? AND read_at IS NULL', [now, user.memberId]);
      }
    },
  }),
  route({
    method: 'get', path: '/admin/templates', tag: 'Notificaciones', summary: 'Plantillas de aviso', auth: ['admin'],
    handler: () => all<TemplateRow>('SELECT * FROM notification_templates ORDER BY name').map((t) => ({
      ...t, send_email: !!t.send_email, send_inapp: !!t.send_inapp, variables: TEMPLATE_VARIABLES[t.key as TemplateKey] ?? [],
    })),
  }),
  route({
    method: 'put', path: '/admin/templates/:key', tag: 'Notificaciones', summary: 'Editar plantilla', auth: ['admin'],
    params: z.object({ key: z.enum(TEMPLATE_KEYS) }).strict(),
    body: z.object({
      subject: z.string().trim().min(3).max(140),
      body: z.string().trim().min(10).max(2000),
      send_email: z.boolean(),
      send_inapp: z.boolean(),
    }).strict(),
    handler: ({ params, body, user, ip }) => {
      const r = run(
        `UPDATE notification_templates SET subject = ?, body = ?, send_email = ?, send_inapp = ?, updated_by = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key = ?`,
        [body.subject, body.body, body.send_email, body.send_inapp, user.id, params.key],
      );
      if (!r.changes) throw notFound('La plantilla');
      audit(user, 'template.update', 'notification_template', null, { key: params.key }, ip);
      return one('SELECT * FROM notification_templates WHERE key = ?', [params.key]);
    },
  }),
  route({
    method: 'post', path: '/admin/templates/:key/preview', tag: 'Notificaciones', summary: 'Vista previa con datos de ejemplo', auth: ['admin'],
    params: z.object({ key: z.enum(TEMPLATE_KEYS) }).strict(),
    body: z.object({ subject: z.string().max(140), body: z.string().max(2000) }).strict(),
    handler: ({ body }) => {
      const sample = {
        nombre: 'Lucía', gimnasio: getSettings().gym_name, plan: 'Trimestral', fecha: '15/11/2026', dias: 3,
        clase: 'Spinning', hora: '19:00', motivo: 'mantenimiento de la sala', monto: 'S/ 180.00', comprobante: 'B001-000123',
      };
      return { subject: render(body.subject, sample), body: render(body.body, sample) };
    },
  }),
  route({
    method: 'get', path: '/admin/outbox', tag: 'Notificaciones', summary: 'Bandeja de correo saliente', auth: ['admin'],
    query: z.object({ status: z.enum(['pending', 'sent', 'failed']).optional() }).strict(),
    handler: ({ query }) => all(
      `SELECT id, to_email, subject, body, template_key, status, attempts, last_error, created_at, sent_at
       FROM email_outbox ${query.status ? 'WHERE status = :status' : ''} ORDER BY id DESC LIMIT 100`,
      query.status ? { status: query.status } : undefined,
    ),
  }),
];

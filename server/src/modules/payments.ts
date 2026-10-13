import { z } from 'zod';
import { all, insert, one, run, tx } from '../db/db.ts';
import { route, idParam, isoDate, money } from '../lib/http.ts';
import { AppError, conflict, forbidden, notFound, unprocessable } from '../lib/errors.ts';
import { audit } from '../lib/audit.ts';
import { clock } from '../lib/clock.ts';
import { getSettings } from '../lib/settings.ts';
import { localDate, localDayRangeUtc, addDays } from '../lib/dates.ts';
import { formatDate, formatMoney, formatTime, maskDni } from '../lib/format.ts';
import { balanceDue } from '../domain/membership.ts';
import { assertMemberAccess } from './access-control.ts';
import { notify } from './notifications.ts';
import { PdfPage, renderPdf } from '../lib/pdf.ts';
import type { AuthUser } from '../lib/http.ts';

export const METHODS = ['cash', 'card', 'transfer'] as const;
export type Method = (typeof METHODS)[number];
export const METHOD_LABEL: Record<Method, string> = { cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia' };

export interface PaymentRow {
  id: number; receipt_number: string; member_id: number | null; membership_id: number | null; concept: string;
  amount_cents: number; method: Method; reference: string | null; paid_at: string; branch_id: number | null;
  received_by: number | null; status: 'valid' | 'voided'; voided_at: string | null; voided_by: number | null; void_reason: string | null;
}

export function paidCents(membershipId: number): number {
  return one<{ s: number }>("SELECT IFNULL(SUM(amount_cents), 0) s FROM payments WHERE membership_id = ? AND status = 'valid'", [membershipId])!.s;
}

export function memberDebt(memberId: number) {
  const rows = all<{ id: number; plan_name: string; start_date: string; end_date: string; amount_due_cents: number; paid: number }>(
    `SELECT ms.id, p.name plan_name, ms.start_date, ms.end_date, ms.amount_due_cents,
       (SELECT IFNULL(SUM(amount_cents),0) FROM payments WHERE membership_id = ms.id AND status = 'valid') paid
     FROM memberships ms JOIN plans p ON p.id = ms.plan_id
     WHERE ms.member_id = ? AND ms.status IN ('active','replaced') ORDER BY ms.start_date`, [memberId],
  );
  const items = rows
    .map((r) => ({ membershipId: r.id, plan: r.plan_name, startDate: r.start_date, endDate: r.end_date,
      amountDueCents: r.amount_due_cents, paidCents: r.paid, balanceCents: balanceDue(r.amount_due_cents, r.paid) }))
    .filter((r) => r.balanceCents > 0);
  return { totalCents: items.reduce((s, r) => s + r.balanceCents, 0), items };
}

function nextReceiptNumber(): string {
  const { last } = one<{ last: number }>('UPDATE receipt_counter SET last = last + 1 WHERE id = 1 RETURNING last')!;
  return `B001-${String(last).padStart(6, '0')}`;
}

export interface NewPayment {
  memberId: number | null;
  membershipId?: number | null;
  amountCents: number;
  method: Method;
  reference?: string | null;
  concept?: string | null;
  branchId?: number | null;
}

/** Registra un pago dentro de una transacción. Valida que no supere la deuda de la membresía. */
export function registerPayment(p: NewPayment, actor: AuthUser, ip?: string): PaymentRow {
  if (p.method === 'transfer' && !(p.reference && p.reference.trim().length >= 4)) {
    throw unprocessable('REFERENCE_REQUIRED', 'Para transferencias ingresa el número de operación.');
  }
  return tx(() => {
    let concept = p.concept?.trim() || null;
    if (p.membershipId) {
      const ms = one<{ id: number; member_id: number; amount_due_cents: number; status: string; plan_name: string; start_date: string; end_date: string }>(
        'SELECT ms.*, pl.name plan_name FROM memberships ms JOIN plans pl ON pl.id = ms.plan_id WHERE ms.id = ?', [p.membershipId],
      );
      if (!ms || ms.member_id !== p.memberId) throw notFound('La membresía');
      if (ms.status === 'cancelled') throw conflict('MEMBERSHIP_CANCELLED', 'La membresía está anulada.');
      const balance = balanceDue(ms.amount_due_cents, paidCents(ms.id));
      if (balance === 0) throw conflict('NOTHING_TO_PAY', 'Esta membresía no tiene saldo pendiente.');
      if (p.amountCents > balance) {
        throw unprocessable('PAYMENT_EXCEEDS_DEBT', `El monto supera el saldo pendiente (${formatMoney(balance)}).`, { balanceCents: balance });
      }
      concept ??= `Plan ${ms.plan_name} · ${formatDate(ms.start_date)} al ${formatDate(ms.end_date)}`;
    }
    if (!concept) throw unprocessable('CONCEPT_REQUIRED', 'Indica el concepto del pago.');
    if (p.memberId && !one('SELECT id FROM members WHERE id = ?', [p.memberId])) throw notFound('El socio');
    const id = insert(
      `INSERT INTO payments (receipt_number, member_id, membership_id, concept, amount_cents, method, reference, paid_at, branch_id, received_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nextReceiptNumber(), p.memberId, p.membershipId ?? null, concept, p.amountCents, p.method, p.reference?.trim() || null,
        clock.now().toISOString(), p.branchId ?? actor.branchId ?? null, actor.id],
    );
    const pay = one<PaymentRow>('SELECT * FROM payments WHERE id = ?', [id])!;
    audit(actor, 'payment.create', 'payment', id, { amount_cents: pay.amount_cents, method: pay.method, membership_id: pay.membership_id }, ip);
    if (pay.member_id) notify(pay.member_id, 'payment_received', { monto: formatMoney(pay.amount_cents), comprobante: pay.receipt_number }, `payment:${id}`);
    return pay;
  });
}

/**
 * Anulación: el pago nunca se borra (trigger en BD). Recepción solo puede anular pagos que ella
 * misma registró el mismo día; administración, cualquiera. Queda en auditoría con el estado previo.
 */
export function voidPayment(id: number, reason: string, actor: AuthUser, ip?: string): PaymentRow {
  return tx(() => {
    const pay = one<PaymentRow>('SELECT * FROM payments WHERE id = ?', [id]);
    if (!pay) throw notFound('El pago');
    if (pay.status === 'voided') throw conflict('ALREADY_VOIDED', 'Este pago ya estaba anulado.');
    if (actor.role === 'reception') {
      const tz = getSettings().timezone;
      const sameDay = localDate(pay.paid_at, tz) === localDate(clock.now(), tz);
      if (pay.received_by !== actor.id || !sameDay) {
        throw forbidden('Recepción solo puede anular sus propios pagos del día. Pide la anulación a administración.');
      }
    }
    run("UPDATE payments SET status = 'voided', voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?",
      [clock.now().toISOString(), actor.id, reason, id]);
    audit(actor, 'payment.void', 'payment', id, { reason, before: pay }, ip);
    if (pay.member_id) {
      notify(pay.member_id, 'payment_voided', { monto: formatMoney(pay.amount_cents), comprobante: pay.receipt_number, motivo: reason }, `void:${id}`);
    }
    return one<PaymentRow>('SELECT * FROM payments WHERE id = ?', [id])!;
  });
}

const PAYMENT_LIST_SQL = `
  SELECT p.*, m.first_name || ' ' || m.last_name member_name, u.full_name received_by_name, v.full_name voided_by_name
  FROM payments p
  LEFT JOIN members m ON m.id = p.member_id
  LEFT JOIN users u ON u.id = p.received_by
  LEFT JOIN users v ON v.id = p.voided_by`;

function receiptPdf(id: number): { buffer: Buffer; filename: string } {
  const p = one<PaymentRow & { member_name: string | null; dni: string | null; received_by_name: string | null; branch_name: string | null }>(
    `SELECT p.*, m.first_name || ' ' || m.last_name member_name, m.dni, u.full_name received_by_name, b.name branch_name
     FROM payments p LEFT JOIN members m ON m.id = p.member_id LEFT JOIN users u ON u.id = p.received_by
     LEFT JOIN branches b ON b.id = p.branch_id WHERE p.id = ?`, [id],
  );
  if (!p) throw notFound('El pago');
  const s = getSettings();
  const pg = new PdfPage(420, 595);
  const L = 36, R = 384;
  pg.rect(0, 0, 420, 8, 0);
  pg.text(L, 52, s.gym_name.toUpperCase(), 26, 'bold');
  pg.text(L, 70, 'COMPROBANTE DE PAGO', 8, 'bold', 0.45);
  pg.textRight(R, 52, p.receipt_number, 12, 'mono');
  pg.textRight(R, 70, `${formatDate(localDate(p.paid_at, s.timezone))} ${formatTime(p.paid_at)}`, 8, 'mono', 0.45);
  pg.line(L, 86, R, 86, 2);

  const rows: [string, string][] = [
    ['SOCIO', p.member_name ?? 'Invitado / venta libre'],
    ['DNI', p.dni ? maskDni(p.dni) : '—'],
    ['CONCEPTO', p.concept],
    ['MÉTODO', METHOD_LABEL[p.method]],
    ['REFERENCIA', p.reference ?? '—'],
    ['SEDE', p.branch_name ?? '—'],
    ['ATENDIDO POR', p.received_by_name ?? '—'],
  ];
  let y = 112;
  for (const [k, v] of rows) {
    pg.text(L, y, k, 7, 'bold', 0.45);
    // Partir conceptos largos en líneas de ~44 caracteres
    const chunks = v.match(/.{1,44}(\s|$)/g) ?? [v];
    chunks.forEach((c, i) => pg.text(130, y + i * 13, c.trim(), 10));
    y += 13 * chunks.length + 9;
    pg.line(L, y - 12, R, y - 12, 0.3, 0.8);
  }
  y += 18;
  pg.text(L, y, 'TOTAL PAGADO', 8, 'bold', 0.45);
  pg.text(L, y + 42, formatMoney(p.amount_cents), 40, 'bold');
  pg.line(L, y + 60, R, y + 60, 2);

  if (p.status === 'voided') {
    pg.rotatedText(210, 300, 'ANULADO', 72, 30, 0.82);
    pg.text(L, y + 82, `ANULADO el ${formatDate(localDate(p.voided_at!, s.timezone))}. Motivo: ${p.void_reason}`.slice(0, 80), 8, 'bold');
  }
  pg.text(L, 560, 'Documento interno de control. No reemplaza al comprobante electrónico tributario.', 7, 'regular', 0.5);
  pg.rect(0, 587, 420, 8, 0);
  return { buffer: renderPdf(pg, `Comprobante ${p.receipt_number}`), filename: `comprobante-${p.receipt_number}.pdf` };
}

const paymentBody = z.object({
  memberId: z.number().int().positive().nullable(),
  membershipId: z.number().int().positive().nullable().optional(),
  amountCents: money,
  method: z.enum(METHODS),
  reference: z.string().trim().max(60).nullable().optional(),
  concept: z.string().trim().min(3).max(140).nullable().optional(),
}).strict();

export const paymentRoutes = [
  route({
    method: 'get', path: '/payments', tag: 'Pagos', summary: 'Listar pagos con totales (caja)', auth: ['reception', 'admin'],
    query: z.object({
      from: isoDate.optional(), to: isoDate.optional(), method: z.enum(METHODS).optional(),
      status: z.enum(['valid', 'voided']).optional(), memberId: z.coerce.number().int().positive().optional(),
    }).strict(),
    handler: ({ query }) => {
      const tz = getSettings().timezone;
      const today = localDate(clock.now(), tz);
      const from = localDayRangeUtc(query.from ?? today, tz).from;
      const to = localDayRangeUtc(query.to ?? query.from ?? today, tz).to;
      const where = ['p.paid_at >= :from', 'p.paid_at < :to'];
      if (query.method) where.push('p.method = :method');
      if (query.status) where.push('p.status = :status');
      if (query.memberId) where.push('p.member_id = :memberId');
      const items = all<PaymentRow>(`${PAYMENT_LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY p.paid_at DESC LIMIT 500`,
        { from, to, method: query.method, status: query.status, memberId: query.memberId });
      const valid = items.filter((i) => i.status === 'valid');
      const byMethod = Object.fromEntries(METHODS.map((m) => [m, valid.filter((i) => i.method === m).reduce((s, i) => s + i.amount_cents, 0)]));
      return { items, totals: { count: valid.length, totalCents: valid.reduce((s, i) => s + i.amount_cents, 0), byMethod, voided: items.length - valid.length } };
    },
  }),
  route({
    method: 'post', path: '/payments', tag: 'Pagos', summary: 'Registrar pago', status: 201, auth: ['reception', 'admin'],
    description: 'Efectivo, tarjeta o transferencia (requiere número de operación). Si se asocia a una membresía, no puede superar su saldo.',
    body: paymentBody,
    handler: ({ body, user, ip }) => registerPayment({ ...body }, user, ip),
  }),
  route({
    method: 'post', path: '/payments/:id/void', tag: 'Pagos', summary: 'Anular pago (no se borra)', auth: ['reception', 'admin'],
    params: idParam,
    body: z.object({ reason: z.string().trim().min(5, 'Describe el motivo (mínimo 5 caracteres)').max(200) }).strict(),
    handler: ({ params, body, user, ip }) => voidPayment(params.id, body.reason, user, ip),
  }),
  route({
    method: 'get', path: '/payments/:id/receipt.pdf', tag: 'Pagos', summary: 'Descargar comprobante PDF', auth: 'any', produces: 'application/pdf',
    params: idParam,
    handler: ({ params, user, res }) => {
      const p = one<{ member_id: number | null }>('SELECT member_id FROM payments WHERE id = ?', [params.id]);
      if (!p) throw notFound('El pago');
      if (p.member_id) assertMemberAccess(user, p.member_id, 'finance');
      else if (!['reception', 'admin'].includes(user.role)) throw forbidden();
      const { buffer, filename } = receiptPdf(params.id);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Cache-Control', 'no-store');
      res.end(buffer);
    },
  }),
  route({
    method: 'get', path: '/members/:id/payments', tag: 'Pagos', summary: 'Pagos y deuda de un socio', auth: 'any',
    params: idParam,
    handler: ({ params, user }) => {
      assertMemberAccess(user, params.id, 'finance');
      return {
        items: all(`${PAYMENT_LIST_SQL} WHERE p.member_id = ? ORDER BY p.paid_at DESC`, [params.id]),
        debt: memberDebt(params.id),
      };
    },
  }),
  route({
    method: 'get', path: '/reports/income', tag: 'Reportes', summary: 'Ingresos por periodo y método de pago', auth: ['admin'],
    query: z.object({ from: isoDate, to: isoDate, groupBy: z.enum(['day', 'week', 'month']).default('day') }).strict(),
    handler: ({ query }) => {
      if (query.to < query.from) throw new AppError(422, 'INVALID_RANGE', 'La fecha final debe ser posterior a la inicial.');
      const tz = getSettings().timezone;
      const rows = all<{ paid_at: string; method: Method; amount_cents: number; status: string }>(
        'SELECT paid_at, method, amount_cents, status FROM payments WHERE paid_at >= ? AND paid_at < ?',
        [localDayRangeUtc(query.from, tz).from, localDayRangeUtc(query.to, tz).to],
      );
      const bucketOf = (iso: string) => {
        const d = localDate(iso, tz);
        if (query.groupBy === 'month') return d.slice(0, 7);
        if (query.groupBy === 'week') {
          const wd = new Date(d + 'T00:00:00Z').getUTCDay() || 7;
          return addDays(d, 1 - wd);
        }
        return d;
      };
      const buckets = new Map<string, Record<Method, number>>();
      const totals: Record<Method, number> = { cash: 0, card: 0, transfer: 0 };
      let voidedCents = 0;
      for (const r of rows) {
        if (r.status !== 'valid') { voidedCents += r.amount_cents; continue; }
        const k = bucketOf(r.paid_at);
        const b = buckets.get(k) ?? { cash: 0, card: 0, transfer: 0 };
        b[r.method] += r.amount_cents;
        buckets.set(k, b);
        totals[r.method] += r.amount_cents;
      }
      return {
        from: query.from, to: query.to, groupBy: query.groupBy,
        series: [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => ({ period, ...v, total: v.cash + v.card + v.transfer })),
        totals: { ...totals, total: totals.cash + totals.card + totals.transfer, voidedCents },
      };
    },
  }),
];



import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer, addMember, NOW, type Client } from '../helpers.ts';
import { all, one, run } from '../../src/db/db.ts';
import { clock } from '../../src/lib/clock.ts';

let api: Client;
let ids: Awaited<ReturnType<typeof setupDb>>;
let rec: string, rec2: string, admin: string, coach: string;

before(async () => {
  ids = await setupDb();
  api = await startServer();
  [rec, rec2, admin, coach] = await Promise.all(['rec@t.pe', 'rec2@t.pe', 'admin@t.pe', 'coach@t.pe'].map((e) => api.login(e)));
});
after(() => api.close());

async function sell(memberId: number, payment?: object) {
  const r = await api.req('POST', `/members/${memberId}/memberships`, { token: rec, body: { planId: ids.monthly, ...(payment ? { payment } : {}) } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body as { membership: { id: number; balanceCents: number }; payment: { id: number; receipt_number: string } | null };
}
const debtOf = async (memberId: number) => (await api.req('GET', `/members/${memberId}/payments`, { token: admin })).body.debt.totalCents as number;

describe('venta y cobro', () => {
  test('venta con pago parcial deja deuda; el saldo se cobra después y no se puede cobrar de más', async () => {
    const m = addMember();
    const { membership, payment } = await sell(m, { amountCents: 5000, method: 'cash' });
    assert.ok(payment);
    assert.match(payment.receipt_number, /^B001-\d{6}$/);
    assert.equal(await debtOf(m), 10000);

    const over = await api.req('POST', '/payments', { token: rec, body: { memberId: m, membershipId: membership.id, amountCents: 10001, method: 'card' } });
    assert.equal(over.status, 422);
    assert.equal(over.body.error.code, 'PAYMENT_EXCEEDS_DEBT');

    const rest = await api.req('POST', '/payments', { token: rec, body: { memberId: m, membershipId: membership.id, amountCents: 10000, method: 'card' } });
    assert.equal(rest.status, 201);
    assert.equal(await debtOf(m), 0);

    const again = await api.req('POST', '/payments', { token: rec, body: { memberId: m, membershipId: membership.id, amountCents: 100, method: 'cash' } });
    assert.equal(again.body.error.code, 'NOTHING_TO_PAY');
  });

  test('transferencia sin número de operación: rechazada', async () => {
    const m = addMember();
    const r = await api.req('POST', `/members/${m}/memberships`, { token: rec, body: { planId: ids.monthly, payment: { amountCents: 15000, method: 'transfer' } } });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'REFERENCE_REQUIRED');
    // La venta se revierte entera: no queda una membresía huérfana sin pago.
    assert.equal(one<{ n: number }>('SELECT COUNT(*) n FROM memberships WHERE member_id = ?', [m])!.n, 0);
  });

  test('montos inválidos no pasan la validación', async () => {
    const r = await api.req('POST', '/payments', { token: rec, body: { memberId: null, amountCents: -5, method: 'cash', concept: 'Agua' } });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.code, 'VALIDATION_ERROR');
  });
});

describe('anulación de pagos', () => {
  test('recepción anula su propio pago del día: la deuda reaparece y queda auditado', async () => {
    const m = addMember();
    const { payment } = await sell(m, { amountCents: 15000, method: 'cash' });
    assert.equal(await debtOf(m), 0);
    const v = await api.req('POST', `/payments/${payment!.id}/void`, { token: rec, body: { reason: 'Monto equivocado' } });
    assert.equal(v.status, 200);
    assert.equal(v.body.status, 'voided');
    assert.equal(await debtOf(m), 15000);
    const log = one<{ action: string; details: string }>("SELECT action, details FROM audit_log WHERE action = 'payment.void' AND entity_id = ?", [payment!.id]);
    assert.ok(log, 'debe existir el registro de auditoría');
    assert.match(log.details, /Monto equivocado/);

    const twice = await api.req('POST', `/payments/${payment!.id}/void`, { token: admin, body: { reason: 'Otra vez' } });
    assert.equal(twice.status, 409);
    assert.equal(twice.body.error.code, 'ALREADY_VOIDED');
  });

  test('recepción no anula pagos de otra persona ni de días anteriores; administración sí', async () => {
    const m = addMember();
    const { payment } = await sell(m, { amountCents: 15000, method: 'card' });
    const other = await api.req('POST', `/payments/${payment!.id}/void`, { token: rec2, body: { reason: 'No corresponde' } });
    assert.equal(other.status, 403);

    clock.set(new Date(new Date(NOW).getTime() + 24 * 3_600_000));
    try {
      const recTomorrow = await api.login('rec@t.pe');
      const late = await api.req('POST', `/payments/${payment!.id}/void`, { token: recTomorrow, body: { reason: 'Me olvidé ayer' } });
      assert.equal(late.status, 403);
      const adminTomorrow = await api.login('admin@t.pe');
      const ok = await api.req('POST', `/payments/${payment!.id}/void`, { token: adminTomorrow, body: { reason: 'Corrección de caja' } });
      assert.equal(ok.status, 200);
    } finally {
      clock.set(NOW);
    }
  });

  test('la base de datos impide borrar o editar pagos aunque se salte la API', () => {
    const p = one<{ id: number }>("SELECT id FROM payments WHERE status = 'valid' LIMIT 1")!;
    assert.throws(() => run('DELETE FROM payments WHERE id = ?', [p.id]), /PAYMENT_DELETE_FORBIDDEN/);
    assert.throws(() => run('UPDATE payments SET amount_cents = 1 WHERE id = ?', [p.id]), /PAYMENT_IMMUTABLE/);
    const v = one<{ id: number }>("SELECT id FROM payments WHERE status = 'voided' LIMIT 1")!;
    assert.throws(() => run("UPDATE payments SET status = 'valid' WHERE id = ?", [v.id]), /PAYMENT_IMMUTABLE/);
  });

  test('la caja del día excluye los anulados', async () => {
    const r = await api.req('GET', '/payments', { token: admin });
    const valid = all<{ amount_cents: number }>("SELECT amount_cents FROM payments WHERE status = 'valid' AND paid_at >= '2026-03-10T05:00:00Z' AND paid_at < '2026-03-11T05:00:00Z'");
    assert.equal(r.body.totals.totalCents, valid.reduce((s, x) => s + x.amount_cents, 0));
    assert.ok(r.body.totals.voided >= 1);
  });
});

describe('comprobante PDF', () => {
  test('el socio descarga el suyo; otro socio y el entrenador no acceden a datos financieros', async () => {
    const mine = addMember({ userId: ids.memberUser });
    const { payment } = await sell(mine, { amountCents: 15000, method: 'cash' });
    const socio = await api.login('socio@t.pe');
    const pdf = await api.req('GET', `/payments/${payment!.id}/receipt.pdf`, { token: socio });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal((pdf.body as Buffer).subarray(0, 5).toString(), '%PDF-');

    const stranger = addMember();
    const { payment: p2 } = await sell(stranger, { amountCents: 15000, method: 'cash' });
    assert.equal((await api.req('GET', `/payments/${p2!.id}/receipt.pdf`, { token: socio })).status, 403);

    run('UPDATE members SET trainer_id = ? WHERE id = ?', [ids.trainer, stranger]);
    assert.equal((await api.req('GET', `/payments/${p2!.id}/receipt.pdf`, { token: coach })).status, 403);
    assert.equal((await api.req('GET', `/members/${stranger}/payments`, { token: coach })).status, 403);
  });
});

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer, addMember, addMembership, dniOf, TODAY, NOW, type Client } from '../helpers.ts';
import { all, insert } from '../../src/db/db.ts';
import { clock } from '../../src/lib/clock.ts';
import { addDays } from '../../src/lib/dates.ts';
import { saveSettings } from '../../src/lib/settings.ts';

let api: Client;
let ids: Awaited<ReturnType<typeof setupDb>>;
let rec: string;

before(async () => {
  ids = await setupDb();
  api = await startServer();
  rec = await api.login('rec@t.pe');
});
after(() => api.close());

const checkin = (code: string) => api.req('POST', '/checkin', { token: rec, body: { code, branchId: ids.branch } });
const visitsOf = (memberId: number) => all<{ result: string; reason: string | null; method: string }>('SELECT result, reason, method FROM visits WHERE member_id = ? ORDER BY id', [memberId]);

describe('check-in por DNI', () => {
  test('membresía vigente: acceso autorizado y un segundo escaneo no duplica la visita', async () => {
    const m = addMember();
    addMembership(m, ids.monthly, addDays(TODAY, -10), addDays(TODAY, 19), { paid: 15000 });
    const r1 = await checkin(dniOf(m));
    assert.equal(r1.status, 200);
    assert.equal(r1.body.result, 'granted');
    assert.equal(r1.body.duplicate, false);
    assert.match(r1.body.member.dni, /•/, 'el DNI se devuelve enmascarado');
    const r2 = await checkin(dniOf(m));
    assert.equal(r2.body.result, 'granted');
    assert.equal(r2.body.duplicate, true);
    assert.equal(visitsOf(m).length, 1);
  });

  test('vence hoy: entra, con aviso de último día', async () => {
    const m = addMember();
    addMembership(m, ids.monthly, addDays(TODAY, -29), TODAY, { paid: 15000 });
    const r = await checkin(dniOf(m));
    assert.equal(r.body.result, 'granted');
    assert.ok(r.body.warnings.some((w: { code: string }) => w.code === 'EXPIRES_TODAY'));
  });

  test('vencido ayer: acceso denegado y el rechazo queda registrado', async () => {
    const m = addMember();
    addMembership(m, ids.monthly, addDays(TODAY, -30), addDays(TODAY, -1), { paid: 15000 });
    const r = await checkin(dniOf(m));
    assert.equal(r.status, 200);
    assert.equal(r.body.result, 'denied');
    assert.equal(r.body.reason, 'EXPIRED');
    assert.deepEqual(visitsOf(m).map((v) => ({ ...v })), [{ result: 'denied', reason: 'EXPIRED', method: 'dni' }]);
  });

  test('por vencer: entra con aviso de días restantes', async () => {
    const m = addMember();
    addMembership(m, ids.monthly, addDays(TODAY, -27), addDays(TODAY, 3), { paid: 15000 });
    const r = await checkin(dniOf(m));
    assert.equal(r.body.result, 'granted');
    assert.ok(r.body.warnings.some((w: { code: string }) => w.code === 'EXPIRING'));
  });

  test('socio sin plan, plan futuro y plan congelado: denegados con el motivo correcto', async () => {
    const none = addMember();
    const future = addMember();
    addMembership(future, ids.monthly, addDays(TODAY, 2), addDays(TODAY, 31), { paid: 15000 });
    const frozen = addMember();
    const ms = addMembership(frozen, ids.monthly, addDays(TODAY, -5), addDays(TODAY, 30), { paid: 15000 });
    insert('INSERT INTO membership_freezes (membership_id, start_date, end_date, reason) VALUES (?, ?, ?, ?)', [ms, addDays(TODAY, -1), addDays(TODAY, 5), 'Viaje']);

    assert.equal((await checkin(dniOf(none))).body.reason, 'NO_MEMBERSHIP');
    assert.equal((await checkin(dniOf(future))).body.reason, 'NOT_STARTED');
    assert.equal((await checkin(dniOf(frozen))).body.reason, 'FROZEN');
  });

  test('con deuda: entra con aviso; si la política lo prohíbe, se deniega', async () => {
    const m = addMember();
    addMembership(m, ids.monthly, addDays(TODAY, -3), addDays(TODAY, 26), { paid: 5000 });
    const ok = await checkin(dniOf(m));
    assert.equal(ok.body.result, 'granted');
    assert.equal(ok.body.debtCents, 10000);
    saveSettings({ checkin_allow_with_debt: false }, null);
    try {
      clock.set(new Date(new Date(NOW).getTime() + 11 * 60_000)); // fuera de la ventana anti-duplicado (10 min)
      const denied = await checkin(dniOf(m));
      assert.equal(denied.body.result, 'denied', JSON.stringify(denied.body));
      assert.equal(denied.body.reason, 'DEBT');
    } finally {
      saveSettings({ checkin_allow_with_debt: true }, null);
      clock.set(NOW);
    }
  });

  test('DNI inexistente: 404 con mensaje claro', async () => {
    const r = await checkin('99999999');
    assert.equal(r.status, 404);
    assert.equal(r.body.error.code, 'MEMBER_NOT_FOUND');
  });
});

describe('check-in por QR', () => {
  test('pase vigente entra; vencido se rechaza; alterado no se reconoce', async () => {
    const m = addMember({ userId: ids.memberUser });
    addMembership(m, ids.monthly, addDays(TODAY, -1), addDays(TODAY, 28), { paid: 15000 });
    const socio = await api.login('socio@t.pe');
    const pass = await api.req('GET', '/me/pass', { token: socio });
    assert.equal(pass.status, 200);

    const tampered = pass.body.payload.replace(/\.(\d+)\./, (_: string, exp: string) => `.${Number(exp) + 600}.`);
    const bad = await checkin(tampered);
    assert.equal(bad.status, 422);
    assert.equal(bad.body.error.code, 'INVALID_PASS');

    const ok = await checkin(pass.body.payload);
    assert.equal(ok.body.result, 'granted');
    assert.equal(ok.body.method, 'qr');

    clock.set(new Date(new Date(NOW).getTime() + 3 * 60_000)); // una captura de pantalla vieja
    try {
      const expired = await checkin(pass.body.payload);
      assert.equal(expired.body.result, 'denied');
      assert.equal(expired.body.reason, 'PASS_EXPIRED');
    } finally {
      clock.set(NOW);
    }
  });

  test('un socio no puede registrar ingresos', async () => {
    const socio = await api.login('socio@t.pe');
    const r = await api.req('POST', '/checkin', { token: socio, body: { code: '12345678', branchId: ids.branch } });
    assert.equal(r.status, 403);
  });
});

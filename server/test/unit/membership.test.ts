import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  membershipState, canAccess, validOn, renewalStart, endDateFor, checkFreeze, endFreezeEarly, prorate, balanceDue,
} from '../../src/domain/membership.ts';

const m = (start: string, end: string, freezes: { start_date: string; end_date: string }[] = []) =>
  ({ start_date: start, end_date: end, status: 'active' as const, freezes });

describe('vencimientos', () => {
  test('vence hoy: el último día SÍ permite ingresar', () => {
    const r = membershipState(m('2026-02-09', '2026-03-10'), '2026-03-10', 7);
    assert.equal(r.state, 'expires_today');
    assert.equal(r.daysLeft, 0);
    assert.ok(canAccess(r.state));
  });

  test('al día siguiente del vencimiento queda vencida y sin acceso', () => {
    const r = membershipState(m('2026-02-09', '2026-03-10'), '2026-03-11', 7);
    assert.equal(r.state, 'expired');
    assert.equal(r.daysLeft, -1);
    assert.ok(!canAccess(r.state));
  });

  test('por vencer dentro del umbral, activa fuera de él', () => {
    assert.equal(membershipState(m('2026-03-01', '2026-03-17'), '2026-03-10', 7).state, 'expiring');
    assert.equal(membershipState(m('2026-03-01', '2026-03-18'), '2026-03-10', 7).state, 'active');
  });

  test('membresía futura: aún no empieza', () => {
    const r = membershipState(m('2026-03-12', '2026-04-10'), '2026-03-10', 7);
    assert.equal(r.state, 'not_started');
    assert.ok(!canAccess(r.state));
  });

  test('socio sin plan', () => {
    assert.equal(membershipState(null, '2026-03-10', 7).state, 'none');
    assert.equal(membershipState({ ...m('2026-03-01', '2026-04-01'), status: 'replaced' }, '2026-03-10', 7).state, 'none');
  });

  test('congelada en las fechas del congelamiento, inclusive', () => {
    const mm = m('2026-03-01', '2026-04-15', [{ start_date: '2026-03-08', end_date: '2026-03-14' }]);
    assert.equal(membershipState(mm, '2026-03-08', 7).state, 'frozen');
    assert.equal(membershipState(mm, '2026-03-14', 7).state, 'frozen');
    assert.equal(membershipState(mm, '2026-03-15', 7).state, 'active');
    assert.equal(membershipState(mm, '2026-03-10', 7).frozenUntil, '2026-03-14');
  });

  test('validOn respeta inicio, fin y congelamientos', () => {
    const mm = m('2026-03-01', '2026-03-31', [{ start_date: '2026-03-20', end_date: '2026-03-22' }]);
    assert.ok(validOn(mm, '2026-03-31'));
    assert.ok(!validOn(mm, '2026-04-01'));
    assert.ok(!validOn(mm, '2026-03-21'));
  });
});

describe('renovación', () => {
  test('vigente: la nueva empieza al día siguiente del vencimiento (sin huecos ni solapes)', () => {
    assert.equal(renewalStart({ end_date: '2026-03-15' }, '2026-03-10'), '2026-03-16');
  });
  test('vence hoy: la nueva empieza mañana', () => {
    assert.equal(renewalStart({ end_date: '2026-03-10' }, '2026-03-10'), '2026-03-11');
  });
  test('vencida: empieza hoy', () => {
    assert.equal(renewalStart({ end_date: '2026-03-01' }, '2026-03-10'), '2026-03-10');
    assert.equal(renewalStart(null, '2026-03-10'), '2026-03-10');
  });
  test('30 días incluye el día de inicio', () => {
    assert.equal(endDateFor('2026-03-10', 30), '2026-04-08');
  });
});

describe('congelamiento', () => {
  const base = { maxFreezeDays: 15, minFreezeDays: 7, usedFreezeDays: 0, today: '2026-03-10' };
  test('suma los días congelados al vencimiento', () => {
    const r = checkFreeze({ ...base, membership: m('2026-03-01', '2026-03-30'), start: '2026-03-12', days: 7 });
    assert.deepEqual(r, { ok: true, end: '2026-03-18', newMembershipEnd: '2026-04-06' });
  });
  test('rechaza: plan sin congelamiento, inicio pasado, muy corto, excede tope, solape', () => {
    const mm = m('2026-03-01', '2026-03-30', [{ start_date: '2026-03-20', end_date: '2026-03-26' }]);
    const code = (r: ReturnType<typeof checkFreeze>) => (r.ok ? 'OK' : r.code);
    assert.equal(code(checkFreeze({ ...base, maxFreezeDays: 0, membership: mm, start: '2026-03-11', days: 7 })), 'FREEZE_NOT_ALLOWED');
    assert.equal(code(checkFreeze({ ...base, membership: mm, start: '2026-03-09', days: 7 })), 'FREEZE_IN_PAST');
    assert.equal(code(checkFreeze({ ...base, membership: mm, start: '2026-03-11', days: 3 })), 'FREEZE_TOO_SHORT');
    assert.equal(code(checkFreeze({ ...base, usedFreezeDays: 10, membership: mm, start: '2026-03-11', days: 7 })), 'FREEZE_LIMIT');
    assert.equal(code(checkFreeze({ ...base, membership: mm, start: '2026-03-15', days: 7 })), 'FREEZE_OVERLAP');
    assert.equal(code(checkFreeze({ ...base, membership: mm, start: '2026-03-31', days: 7 })), 'FREEZE_AFTER_END');
  });
  test('reactivación anticipada devuelve los días no usados', () => {
    const r = endFreezeEarly({ start_date: '2026-03-05', end_date: '2026-03-18' }, '2026-04-20', '2026-03-10');
    assert.equal(r.newFreezeEnd, '2026-03-09');
    assert.equal(r.daysReturned, 9);
    assert.equal(r.newMembershipEnd, '2026-04-11');
  });
  test('reactivar antes de que empiece anula todo el congelamiento', () => {
    const r = endFreezeEarly({ start_date: '2026-03-12', end_date: '2026-03-18' }, '2026-04-20', '2026-03-10');
    assert.ok(r.cancelWhole);
    assert.equal(r.daysReturned, 7);
    assert.equal(r.newMembershipEnd, '2026-04-13');
  });
});

describe('prorrateo al cambiar de plan', () => {
  const old = { start_date: '2026-03-01', end_date: '2026-03-30', list_price_cents: 15000, credit_cents: 0 };

  test('pagado completo a mitad de periodo: crédito por lo no usado', () => {
    const r = prorate({ old: { ...old, paid_cents: 15000 }, newPriceCents: 42000, today: '2026-03-16' });
    assert.equal(r.consumedDays, 15);
    assert.equal(r.consumedValueCents, 7500);
    assert.equal(r.creditCents, 7500);
    assert.equal(r.newAmountDueCents, 34500);
    assert.equal(r.oldAmountDueCents, 7500);
  });

  test('sin pagar nada: no hay crédito y lo consumido queda como deuda', () => {
    const r = prorate({ old: { ...old, paid_cents: 0 }, newPriceCents: 42000, today: '2026-03-16' });
    assert.equal(r.creditCents, 0);
    assert.equal(r.oldAmountDueCents, 7500);
    assert.equal(r.newAmountDueCents, 42000);
  });

  test('invariante: pagado + deudas = valor consumido + plan nuevo − excedente', () => {
    for (const paid of [0, 5000, 7500, 12000, 15000]) {
      for (const today of ['2026-03-01', '2026-03-02', '2026-03-16', '2026-03-30']) {
        for (const newPrice of [5000, 15000, 42000]) {
          const r = prorate({ old: { ...old, paid_cents: paid }, newPriceCents: newPrice, today });
          const oldDebt = balanceDue(r.oldAmountDueCents, paid);
          // Lo pagado + lo que aún debe (plan viejo) + lo que pagará (plan nuevo) = lo que recibió + excedente no aplicado
          assert.equal(paid + oldDebt + r.newAmountDueCents, r.consumedValueCents + newPrice + r.leftoverCreditCents,
            `paid=${paid} today=${today} new=${newPrice}`);
          assert.ok(r.newAmountDueCents >= 0 && r.creditCents <= newPrice);
        }
      }
    }
  });

  test('cambio el mismo día de inicio: todo lo pagado es crédito', () => {
    const r = prorate({ old: { ...old, paid_cents: 15000 }, newPriceCents: 42000, today: '2026-03-01' });
    assert.equal(r.consumedDays, 0);
    assert.equal(r.creditCents, 15000);
    assert.equal(r.newAmountDueCents, 27000);
  });

  test('plan nuevo más barato que el crédito: se cobra 0 y el excedente queda registrado', () => {
    const r = prorate({ old: { ...old, paid_cents: 15000 }, newPriceCents: 5000, today: '2026-03-04' });
    assert.equal(r.newAmountDueCents, 0);
    assert.equal(r.creditCents, 5000);
    assert.equal(r.leftoverCreditCents, 13500 - 5000);
  });
});

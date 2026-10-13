import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decideBooking, decideCancel, pickPromotions, orderWaitlist } from '../../src/domain/classes.ts';

const now = new Date('2026-03-10T15:00:00Z');
const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();
const session = (h: number, capacity = 10, status: 'scheduled' | 'cancelled' = 'scheduled') => ({ starts_at: inHours(h), capacity, status });

describe('reservas y cupos', () => {
  test('con cupo: reserva confirmada', () => {
    assert.deepEqual(decideBooking({ session: session(5), bookedCount: 9, now, windowDays: 7, hasLiveReservation: false }), { ok: true, status: 'booked' });
  });
  test('sin cupo: pasa a lista de espera (no se sobrevende)', () => {
    assert.deepEqual(decideBooking({ session: session(5), bookedCount: 10, now, windowDays: 7, hasLiveReservation: false }), { ok: true, status: 'waitlist' });
  });
  test('rechaza doble reserva, clase cancelada, ya empezada o fuera de ventana', () => {
    const code = (r: ReturnType<typeof decideBooking>) => (r.ok ? r.status : r.code);
    assert.equal(code(decideBooking({ session: session(5), bookedCount: 0, now, windowDays: 7, hasLiveReservation: true })), 'ALREADY_BOOKED');
    assert.equal(code(decideBooking({ session: session(5, 10, 'cancelled'), bookedCount: 0, now, windowDays: 7, hasLiveReservation: false })), 'CLASS_CANCELLED');
    assert.equal(code(decideBooking({ session: session(0), bookedCount: 0, now, windowDays: 7, hasLiveReservation: false })), 'CLASS_STARTED');
    assert.equal(code(decideBooking({ session: session(24 * 8), bookedCount: 0, now, windowDays: 7, hasLiveReservation: false })), 'BOOKING_TOO_EARLY');
  });
});

describe('política de cancelación (mínimo 2 h)', () => {
  const base = { now, minHours: 2, byStaff: false };
  test('socio con anticipación suficiente: libera cupo', () => {
    assert.deepEqual(decideCancel({ ...base, reservationStatus: 'booked', startsAt: inHours(3) }), { ok: true, late: false, freesSeat: true });
  });
  test('justo en el límite de 2 h todavía se permite', () => {
    assert.deepEqual(decideCancel({ ...base, reservationStatus: 'booked', startsAt: inHours(2) }), { ok: true, late: false, freesSeat: true });
  });
  test('socio tarde: rechazado', () => {
    const r = decideCancel({ ...base, reservationStatus: 'booked', startsAt: inHours(1.5) });
    assert.equal(r.ok ? 'ok' : r.code, 'CANCEL_TOO_LATE');
  });
  test('recepción puede cancelar tarde y queda marcada', () => {
    assert.deepEqual(decideCancel({ ...base, byStaff: true, reservationStatus: 'booked', startsAt: inHours(1) }), { ok: true, late: true, freesSeat: true });
  });
  test('salir de la lista de espera siempre se permite y no libera cupo', () => {
    assert.deepEqual(decideCancel({ ...base, reservationStatus: 'waitlist', startsAt: inHours(0.5) }), { ok: true, late: false, freesSeat: false });
  });
  test('reservas ya canceladas o asistidas no se cancelan', () => {
    const r = decideCancel({ ...base, reservationStatus: 'attended', startsAt: inHours(5) });
    assert.equal(r.ok ? 'ok' : r.code, 'NOT_CANCELLABLE');
  });
});

describe('lista de espera', () => {
  const wl = [
    { id: 3, member_id: 30, waitlist_at: '2026-03-10T10:05:00Z' },
    { id: 1, member_id: 10, waitlist_at: '2026-03-10T10:00:00Z' },
    { id: 2, member_id: 20, waitlist_at: '2026-03-10T10:00:00Z' },
  ];
  test('orden FIFO con desempate por id', () => {
    assert.deepEqual(orderWaitlist(wl).map((e) => e.member_id), [10, 20, 30]);
  });
  test('un cupo liberado promueve solo al primero', () => {
    assert.deepEqual(pickPromotions(wl, 1, () => true).promote.map((e) => e.member_id), [10]);
  });
  test('salta a quien ya no es elegible (p. ej. plan vencido) y promueve al siguiente', () => {
    const r = pickPromotions(wl, 1, (e) => e.member_id !== 10);
    assert.deepEqual(r.promote.map((e) => e.member_id), [20]);
    assert.deepEqual(r.skip.map((e) => e.member_id), [10]);
  });
  test('sin cupos libres no promueve a nadie', () => {
    assert.equal(pickPromotions(wl, 0, () => true).promote.length, 0);
  });
});

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer, addMember, addMembership, TODAY, NOW, type Client } from '../helpers.ts';
import { all, insert, one } from '../../src/db/db.ts';
import { addDays } from '../../src/lib/dates.ts';

let api: Client;
let ids: Awaited<ReturnType<typeof setupDb>>;
let rec: string;
let classType: number;

const hoursFromNow = (h: number) => new Date(new Date(NOW).getTime() + h * 3_600_000).toISOString();

function session(startsInHours: number, capacity: number): number {
  return insert('INSERT INTO class_sessions (class_type_id, branch_id, trainer_id, starts_at, ends_at, capacity, room) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [classType, ids.branch, ids.trainer, hoursFromNow(startsInHours), hoursFromNow(startsInHours + 1), capacity, 'Sala 1']);
}
function memberWithPlan(plan = ids.monthly, opts: { userId?: number } = {}): number {
  const m = addMember(opts);
  addMembership(m, plan, addDays(TODAY, -5), addDays(TODAY, 24), { paid: 15000 });
  return m;
}
const book = (sessionId: number, memberId: number) => api.req('POST', `/classes/sessions/${sessionId}/book`, { token: rec, body: { memberId } });

before(async () => {
  ids = await setupDb();
  api = await startServer();
  rec = await api.login('rec@t.pe');
  classType = insert("INSERT INTO class_types (name, intensity) VALUES ('Spinning', 3)");
});
after(() => api.close());

describe('cupos y lista de espera', () => {
  test('no se sobrevende: al llenarse, el siguiente entra a lista de espera con su posición', async () => {
    const s = session(24, 2);
    const [a, b, c, d] = [memberWithPlan(), memberWithPlan(), memberWithPlan(), memberWithPlan()];
    assert.equal((await book(s, a)).body.reservation.status, 'booked');
    assert.equal((await book(s, b)).body.reservation.status, 'booked');
    const rc = await book(s, c);
    assert.equal(rc.body.reservation.status, 'waitlist');
    assert.equal(rc.body.waitlistPosition, 1);
    assert.equal((await book(s, d)).body.waitlistPosition, 2);

    const detail = await api.req('GET', `/classes/sessions/${s}`, { token: rec });
    assert.equal(detail.body.booked, 2);
    assert.equal(detail.body.spotsLeft, 0);
    assert.equal(detail.body.waitlist, 2);
  });

  test('doble reserva del mismo socio: rechazada', async () => {
    const s = session(26, 5);
    const a = memberWithPlan();
    await book(s, a);
    const again = await book(s, a);
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'ALREADY_BOOKED');
  });

  test('cupo liberado: promueve al primero de la lista (FIFO) y le avisa', async () => {
    const s = session(30, 1);
    const [a, b, c] = [memberWithPlan(), memberWithPlan(), memberWithPlan()];
    const ra = (await book(s, a)).body.reservation.id;
    await book(s, b);
    await book(s, c);
    const cancel = await api.req('POST', `/reservations/${ra}/cancel`, { token: rec });
    assert.equal(cancel.status, 200);
    assert.deepEqual(cancel.body.promotedMemberIds, [b]);
    const statuses = Object.fromEntries(all<{ member_id: number; status: string }>('SELECT member_id, status FROM reservations WHERE session_id = ?', [s]).map((r) => [r.member_id, r.status]));
    assert.deepEqual(statuses, { [a]: 'cancelled', [b]: 'booked', [c]: 'waitlist' });
    assert.ok(one("SELECT id FROM notifications WHERE member_id = ? AND template_key = 'waitlist_promoted'", [b]));
    assert.equal((await api.req('GET', `/classes/sessions/${s}`, { token: rec })).body.roster.find((r: { member_id: number }) => r.member_id === c).status, 'waitlist');
  });

  test('si el primero de la lista ya no tiene plan vigente, se salta al siguiente', async () => {
    const s = session(30, 1);
    const [a, b, c] = [memberWithPlan(), addMember(), memberWithPlan()];
    // b reservó cuando tenía plan; luego su plan se anuló.
    const msB = addMembership(b, ids.monthly, addDays(TODAY, -5), addDays(TODAY, 24), { paid: 15000 });
    const ra = (await book(s, a)).body.reservation.id;
    await book(s, b);
    await book(s, c);
    insert("UPDATE memberships SET status = 'cancelled' WHERE id = ?", [msB]);
    const cancel = await api.req('POST', `/reservations/${ra}/cancel`, { token: rec });
    assert.deepEqual(cancel.body.promotedMemberIds, [c]);
  });

  test('la base de datos impide superar el cupo aunque se salte la API', () => {
    const s = session(40, 1);
    const [a, b] = [memberWithPlan(), memberWithPlan()];
    insert("INSERT INTO reservations (session_id, member_id, status, created_at) VALUES (?, ?, 'booked', ?)", [s, a, NOW]);
    assert.throws(
      () => insert("INSERT INTO reservations (session_id, member_id, status, created_at) VALUES (?, ?, 'booked', ?)", [s, b, NOW]),
      /CLASS_FULL/,
    );
  });
});

describe('reglas de reserva y cancelación', () => {
  test('plan sin clases o sin plan vigente ese día: no puede reservar', async () => {
    const s = session(24, 10);
    const gymOnly = memberWithPlan(ids.gymOnly);
    const r1 = await book(s, gymOnly);
    assert.equal(r1.status, 422);
    assert.equal(r1.body.error.code, 'PLAN_EXCLUDES_CLASSES');
    const none = addMember();
    assert.equal((await book(s, none)).body.error.code, 'MEMBERSHIP_REQUIRED');
  });

  test('el socio no cancela con menos de 2 h; recepción sí, y queda como tardía', async () => {
    const s = session(1, 10);
    const m = memberWithPlan(ids.monthly, { userId: ids.memberUser });
    const socio = await api.login('socio@t.pe');
    const booked = await api.req('POST', `/classes/sessions/${s}/book`, { token: socio, body: {} });
    assert.equal(booked.status, 201);
    const rid = booked.body.reservation.id;
    const late = await api.req('POST', `/reservations/${rid}/cancel`, { token: socio });
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'CANCEL_TOO_LATE');
    const byStaff = await api.req('POST', `/reservations/${rid}/cancel`, { token: rec });
    assert.equal(byStaff.status, 200);
    assert.equal(byStaff.body.late, true);
    assert.equal(one<{ member_id: number }>('SELECT member_id FROM reservations WHERE id = ?', [rid])!.member_id, m);
  });

  test('clase cancelada: avisa a inscritos y a la lista de espera', async () => {
    const s = session(48, 1);
    const [a, b] = [memberWithPlan(), memberWithPlan()];
    await book(s, a);
    await book(s, b);
    const admin = await api.login('admin@t.pe');
    const r = await api.req('POST', `/classes/sessions/${s}/cancel`, { token: admin, body: { reason: 'Instructor enfermo' } });
    assert.equal(r.body.notified, 2);
    assert.equal(all("SELECT id FROM notifications WHERE template_key = 'class_cancelled' AND member_id IN (?, ?)", [a, b]).length, 2);
    assert.equal((await book(s, memberWithPlan())).body.error.code, 'CLASS_CANCELLED');
  });
});

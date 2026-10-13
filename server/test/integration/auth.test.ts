import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { setupDb, startServer, addMember, NOW, PASSWORD, type Client } from '../helpers.ts';
import { all, one, run } from '../../src/db/db.ts';
import { clock } from '../../src/lib/clock.ts';

let api: Client;
let ids: Awaited<ReturnType<typeof setupDb>>;

before(async () => {
  ids = await setupDb();
  api = await startServer();
});
after(() => api.close());

const cookieOf = (h: Headers) => (h.get('set-cookie') ?? '').split(';')[0];

describe('sesiones', () => {
  test('login correcto devuelve token y cookie httpOnly; credenciales malas, mensaje genérico', async () => {
    const ok = await api.req('POST', '/auth/login', { body: { email: 'ADMIN@t.pe', password: PASSWORD } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.role, 'admin');
    assert.match(ok.headers.get('set-cookie') ?? '', /HttpOnly; SameSite=Strict/);
    const bad = await api.req('POST', '/auth/login', { body: { email: 'admin@t.pe', password: 'otra-cosa-1' } });
    const ghost = await api.req('POST', '/auth/login', { body: { email: 'nadie@t.pe', password: 'otra-cosa-1' } });
    assert.equal(bad.status, 401);
    assert.deepEqual(bad.body, ghost.body, 'no revela si el correo existe');
  });

  test('access token expira a los 15 minutos', async () => {
    const t = await api.login('rec@t.pe');
    assert.equal((await api.req('GET', '/auth/me', { token: t })).status, 200);
    clock.set(new Date(new Date(NOW).getTime() + 16 * 60_000));
    try {
      assert.equal((await api.req('GET', '/auth/me', { token: t })).status, 401);
    } finally {
      clock.set(NOW);
    }
  });

  test('refresh rota el token; reutilizar uno viejo cierra toda la familia de sesiones', async () => {
    const login = await api.req('POST', '/auth/login', { body: { email: 'coach@t.pe', password: PASSWORD } });
    const c1 = cookieOf(login.headers);
    const r1 = await api.req('POST', '/auth/refresh', { cookie: c1 });
    assert.equal(r1.status, 200);
    const c2 = cookieOf(r1.headers);
    assert.notEqual(c1, c2);

    // Fuera del margen de 30 s para pestañas simultáneas, reutilizar el token viejo es sospechoso.
    clock.set(new Date(new Date(NOW).getTime() + 31_000));
    const reuse = await api.req('POST', '/auth/refresh', { cookie: c1 }).finally(() => clock.set(NOW));
    assert.equal(reuse.status, 401);
    assert.equal((await api.req('POST', '/auth/refresh', { cookie: c2 })).status, 401, 'el token nuevo también queda revocado');
    assert.ok(one("SELECT id FROM audit_log WHERE action = 'auth.refresh_reuse'"));
  });

  test('dos pestañas que renuevan a la vez con el mismo token no cierran la sesión', async () => {
    const login = await api.req('POST', '/auth/login', { body: { email: 'admin@t.pe', password: PASSWORD } });
    const c = cookieOf(login.headers);
    const [a, b] = await Promise.all([api.req('POST', '/auth/refresh', { cookie: c }), api.req('POST', '/auth/refresh', { cookie: c })]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal((await api.req('POST', '/auth/refresh', { cookie: cookieOf(a.headers) })).status, 200);
  });

  test('tras cerrar sesión, el token ya no sirve aunque sea reciente', async () => {
    const login = await api.req('POST', '/auth/login', { body: { email: 'admin@t.pe', password: PASSWORD } });
    const c = cookieOf(login.headers);
    const r = await api.req('POST', '/auth/refresh', { cookie: c });
    await api.req('POST', '/auth/logout', { cookie: cookieOf(r.headers) });
    assert.equal((await api.req('POST', '/auth/refresh', { cookie: c })).status, 401);
  });

  test('refresh sin el encabezado propio de la app: bloqueado (CSRF)', async () => {
    const login = await api.req('POST', '/auth/login', { body: { email: 'rec2@t.pe', password: PASSWORD } });
    const res = await fetch(`${api.url}/api/auth/refresh`, { method: 'POST', headers: { Cookie: cookieOf(login.headers) } });
    assert.equal(res.status, 403);
  });
});

describe('fuerza bruta', () => {
  test('5 intentos fallidos bloquean la cuenta, incluso con la contraseña correcta', async () => {
    run('DELETE FROM login_attempts');
    for (let i = 0; i < 5; i++) {
      assert.equal((await api.req('POST', '/auth/login', { body: { email: 'rec@t.pe', password: `mala-${i}-xx` } })).status, 401);
    }
    const locked = await api.req('POST', '/auth/login', { body: { email: 'rec@t.pe', password: PASSWORD } });
    assert.equal(locked.status, 429);
    assert.equal(locked.body.error.code, 'TOO_MANY_ATTEMPTS');
    assert.ok(locked.body.error.details.retryAfterSec > 0);

    clock.set(new Date(new Date(NOW).getTime() + 16 * 60_000));
    try {
      assert.equal((await api.req('POST', '/auth/login', { body: { email: 'rec@t.pe', password: PASSWORD } })).status, 200);
    } finally {
      clock.set(NOW);
    }
  });
});

describe('roles y datos personales', () => {
  test('sin token 401; socio fuera de su rol 403', async () => {
    assert.equal((await api.req('GET', '/members')).status, 401);
    const m = addMember({ userId: ids.memberUser });
    const socio = await api.login('socio@t.pe');
    assert.equal((await api.req('GET', '/members', { token: socio })).status, 403);
    assert.equal((await api.req('GET', '/reports/overview', { token: socio })).status, 403);
    const other = addMember();
    assert.equal((await api.req('GET', `/members/${other}`, { token: socio })).status, 403);
    assert.equal((await api.req('GET', `/members/${m}`, { token: socio })).status, 200);
  });

  test('recepción ve el DNI completo pero no la salud; queda registrado quién consultó', async () => {
    const m = addMember();
    run("UPDATE members SET health_notes = 'Hipertensión' WHERE id = ?", [m]);
    const rec = await api.login('rec2@t.pe');
    const r = await api.req('GET', `/members/${m}`, { token: rec });
    assert.equal(r.body.member.dniMasked, false);
    assert.equal(r.body.member.healthNotes, null);
    assert.equal(r.body.member.healthRestricted, true);
    const logs = all<{ actor_id: number; details: string }>("SELECT actor_id, details FROM audit_log WHERE action = 'pii.view' AND entity_id = ?", [m]);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actor_id, ids.reception2);
    assert.deepEqual(JSON.parse(logs[0].details).fields, ['dni']);
  });

  test('el entrenador solo ve a sus socios asignados; ve salud pero no DNI ni pagos', async () => {
    const mine = addMember({ trainerId: ids.trainer });
    run("UPDATE members SET health_notes = 'Lesión de rodilla' WHERE id = ?", [mine]);
    const notMine = addMember();
    const coach = await api.login('coach@t.pe');
    const r = await api.req('GET', `/members/${mine}`, { token: coach });
    assert.equal(r.status, 200);
    assert.equal(r.body.member.healthNotes, 'Lesión de rodilla');
    assert.equal(r.body.member.dniMasked, true);
    assert.equal(r.body.debt, null);
    assert.equal((await api.req('GET', `/members/${notMine}`, { token: coach })).status, 403);
    const list = await api.req('GET', '/members', { token: coach });
    assert.deepEqual(list.body.items.map((i: { id: number }) => i.id), [mine]);
  });
});

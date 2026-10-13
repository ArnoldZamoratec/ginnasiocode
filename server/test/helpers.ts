import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb, useDb, insert, one, run } from '../src/db/db.ts';
import { migrate } from '../src/db/migrate.ts';
import { resetSettingsCache } from '../src/lib/settings.ts';
import { seedTemplates } from '../src/modules/notifications.ts';
import { hashPassword } from '../src/lib/crypto.ts';
import { clock } from '../src/lib/clock.ts';
import { createApp } from '../src/app.ts';

export const PASSWORD = 'Prueba-12345';
/** 10:00 en Lima (UTC-5). */
export const NOW = '2026-03-10T15:00:00.000Z';
export const TODAY = '2026-03-10';

export async function setupDb() {
  const conn = openDb(':memory:');
  useDb(conn);
  migrate(conn);
  resetSettingsCache();
  seedTemplates();
  clock.set(NOW);
  const hash = await hashPassword(PASSWORD);
  const branch = insert("INSERT INTO branches (name) VALUES ('Central')");
  const user = (email: string, role: string) => insert('INSERT INTO users (email, password_hash, role, full_name, branch_id) VALUES (?, ?, ?, ?, ?)', [email, hash, role, email.split('@')[0], branch]);
  const ids = {
    branch,
    admin: user('admin@t.pe', 'admin'),
    reception: user('rec@t.pe', 'reception'),
    reception2: user('rec2@t.pe', 'reception'),
    trainer: user('coach@t.pe', 'trainer'),
    memberUser: user('socio@t.pe', 'member'),
    monthly: insert("INSERT INTO plans (name, duration_days, price_cents, includes_classes, max_freeze_days) VALUES ('Mensual', 30, 15000, 1, 10)"),
    gymOnly: insert("INSERT INTO plans (name, duration_days, price_cents, includes_classes, max_freeze_days) VALUES ('Solo sala', 30, 10000, 0, 0)"),
  };
  return ids;
}

let dniSeq = 40000000;
export function addMember(opts: { userId?: number; trainerId?: number; email?: string } = {}): number {
  dniSeq++;
  return insert('INSERT INTO members (dni, first_name, last_name, email, user_id, trainer_id) VALUES (?, ?, ?, ?, ?, ?)',
    [String(dniSeq), 'Ana', `Prueba${dniSeq}`, opts.email ?? `a${dniSeq}@t.pe`, opts.userId ?? null, opts.trainerId ?? null]);
}

export function dniOf(memberId: number): string {
  return one<{ dni: string }>('SELECT dni FROM members WHERE id = ?', [memberId])!.dni;
}

export function addMembership(memberId: number, planId: number, start: string, end: string, opts: { due?: number; paid?: number } = {}): number {
  const due = opts.due ?? 15000;
  const id = insert('INSERT INTO memberships (member_id, plan_id, start_date, end_date, list_price_cents, amount_due_cents) VALUES (?, ?, ?, ?, ?, ?)',
    [memberId, planId, start, end, due, due]);
  if (opts.paid) {
    const n = Math.floor(Math.random() * 1e9);
    run("INSERT INTO payments (receipt_number, member_id, membership_id, concept, amount_cents, method, paid_at) VALUES (?, ?, ?, 'x', ?, 'cash', ?)",
      [`T-${n}`, memberId, id, opts.paid, NOW]);
  }
  return id;
}

export interface Client {
  url: string;
  close(): Promise<void>;
  login(email: string, password?: string): Promise<string>;
  req(method: string, path: string, opts?: { token?: string; body?: unknown; cookie?: string }): Promise<{ status: number; body: any; headers: Headers }>;
}

export async function startServer(): Promise<Client> {
  const app = createApp();
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const req: Client['req'] = async (method, path, opts = {}) => {
    const res = await fetch(url + '/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json', 'X-Requested-With': 'gymos',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const type = res.headers.get('content-type') ?? '';
    const body = type.includes('json') ? await res.json() : type.includes('pdf') ? Buffer.from(await res.arrayBuffer()) : await res.text();
    return { status: res.status, body, headers: res.headers };
  };
  return {
    url,
    req,
    async login(email, password = PASSWORD) {
      const r = await req('POST', '/auth/login', { body: { email, password } });
      if (r.status !== 200) throw new Error(`login ${email}: ${JSON.stringify(r.body)}`);
      return r.body.accessToken as string;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

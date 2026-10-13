/**
 * Datos de demostración realistas. Uso: npm run seed  (borra y recrea la BD indicada en DB_PATH).
 * Es determinista (PRNG con semilla) salvo por la fecha actual, a la que se anclan todos los datos.
 */
import { rmSync, existsSync } from 'node:fs';
import { config } from '../config.ts';
import { openDb, useDb, insert, run, one, all } from '../db/db.ts';
import { migrate } from '../db/migrate.ts';
import { hashPassword } from '../lib/crypto.ts';
import { addDays, localDate, localToUtc, weekdayOf } from '../lib/dates.ts';
import { getSettings } from '../lib/settings.ts';
import { clock } from '../lib/clock.ts';
import { seedTemplates } from '../modules/notifications.ts';
import { generateSessions } from '../modules/classes.ts';
import { runExpiryReminders, markNoShows } from '../jobs.ts';

const DEMO_PASSWORD = 'GymOS-2026';

// ------------------------------------------------------------------ PRNG
let seed = 20261012;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;

if (config.dbPath !== ':memory:') {
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(config.dbPath + suffix)) rmSync(config.dbPath + suffix);
}
const conn = openDb(config.dbPath);
useDb(conn);
migrate(conn);
seedTemplates();

const tz = getSettings().timezone;
const today = localDate(clock.now(), tz);
const at = (date: string, h: number, m: number) => localToUtc(date, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, tz).toISOString();
const nowIso = clock.now().toISOString();

conn.exec('BEGIN');

// ----------------------------------------------------------------- sedes
const miraflores = insert("INSERT INTO branches (name, address, opens_at, closes_at, capacity) VALUES ('Miraflores', 'Av. José Larco 1150, Miraflores', '05:30', '23:00', 140)");
const sanIsidro = insert("INSERT INTO branches (name, address, opens_at, closes_at, capacity) VALUES ('San Isidro', 'Av. Camino Real 390, San Isidro', '06:00', '22:00', 90)");

// --------------------------------------------------------------- personal
const hash = await hashPassword(DEMO_PASSWORD);
const staff = (email: string, name: string, role: string, branch: number, phone: string) =>
  insert('INSERT INTO users (email, password_hash, role, full_name, branch_id, phone) VALUES (?, ?, ?, ?, ?, ?)', [email, hash, role, name, branch, phone]);
const admin = staff('admin@gymos.pe', 'Carolina Vega Salazar', 'admin', miraflores, '987 654 321');
const recep = staff('recepcion@gymos.pe', 'Diego Paredes Ríos', 'reception', miraflores, '981 220 114');
staff('recepcion.si@gymos.pe', 'Andrea Lozano Cruz', 'reception', sanIsidro, '981 330 509');
const renzo = staff('entrenador@gymos.pe', 'Renzo Castillo Medina', 'trainer', miraflores, '976 102 778');
const valeria = staff('valeria@gymos.pe', 'Valeria Quispe Aguilar', 'trainer', miraflores, '976 448 120');
const bruno = staff('bruno@gymos.pe', 'Bruno Delgado Ramos', 'trainer', sanIsidro, '976 905 233');
const trainers = [renzo, valeria, bruno];

// ----------------------------------------------------------------- planes
const plan = (name: string, desc: string, days: number, price: number, classes: boolean, freeze: number) =>
  insert('INSERT INTO plans (name, description, duration_days, price_cents, includes_classes, max_freeze_days) VALUES (?, ?, ?, ?, ?, ?)', [name, desc, days, price * 100, classes, freeze]);
const P = {
  mensual: { id: plan('Mensual', 'Sala de máquinas y clases grupales.', 30, 159, true, 7), days: 30, price: 15900 },
  trimestral: { id: plan('Trimestral', 'Tres meses con clases. Congela hasta 15 días.', 90, 429, true, 15), days: 90, price: 42900 },
  semestral: { id: plan('Semestral', 'Seis meses con clases. Congela hasta 30 días.', 180, 789, true, 30), days: 180, price: 78900 },
  anual: { id: plan('Anual', 'Doce meses con clases. Congela hasta 45 días.', 365, 1390, true, 45), days: 365, price: 139000 },
  sala: { id: plan('Solo sala', 'Sala de máquinas, sin clases grupales.', 30, 119, false, 0), days: 30, price: 11900 },
};
plan('Mensual estudiante (descontinuado)', 'Plan anterior a 2026.', 30, 99, true, 0);
run("UPDATE plans SET active = 0 WHERE name LIKE '%descontinuado%'");
const planList = [P.mensual, P.mensual, P.mensual, P.trimestral, P.trimestral, P.semestral, P.anual, P.sala];

// ---------------------------------------------------------------- clases
const ct = (name: string, desc: string, intensity: number) => insert('INSERT INTO class_types (name, description, intensity) VALUES (?, ?, ?)', [name, desc, intensity]);
const C = {
  spinning: ct('Spinning', 'Ciclismo indoor por intervalos.', 3),
  funcional: ct('Funcional', 'Circuitos con peso corporal, kettlebells y TRX.', 3),
  yoga: ct('Yoga', 'Vinyasa suave, movilidad y respiración.', 1),
  pilates: ct('Pilates', 'Core y control postural en colchoneta.', 2),
  box: ct('Box', 'Técnica de golpeo y acondicionamiento.', 3),
  hiit: ct('HIIT', 'Intervalos de alta intensidad, 45 minutos.', 3),
  movilidad: ct('Movilidad', 'Rango articular y recuperación activa.', 1),
};
const sched = (type: number, branch: number, trainer: number, days: number[], time: string, dur: number, cap: number, room: string) => {
  for (const wd of days) insert('INSERT INTO class_schedules (class_type_id, branch_id, trainer_id, weekday, start_time, duration_min, capacity, room) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [type, branch, trainer, wd, time, dur, cap, room]);
};
sched(C.spinning, miraflores, renzo, [1, 3, 5], '06:30', 45, 20, 'Sala Ciclo');
sched(C.spinning, miraflores, renzo, [1, 2, 3, 4], '19:00', 45, 20, 'Sala Ciclo');
sched(C.funcional, miraflores, valeria, [2, 4], '07:00', 50, 16, 'Sala 1');
sched(C.funcional, miraflores, valeria, [1, 3, 5], '18:00', 50, 16, 'Sala 1');
sched(C.yoga, miraflores, valeria, [2, 4, 6], '09:00', 60, 18, 'Sala 2');
sched(C.pilates, miraflores, valeria, [1, 3], '12:30', 50, 12, 'Sala 2');
sched(C.box, miraflores, renzo, [2, 4], '20:00', 60, 14, 'Sala 1');
sched(C.hiit, miraflores, renzo, [5], '19:00', 45, 18, 'Sala 1');
sched(C.hiit, miraflores, renzo, [6], '10:00', 45, 18, 'Sala 1');
sched(C.movilidad, miraflores, valeria, [7], '10:00', 50, 20, 'Sala 2');
sched(C.funcional, sanIsidro, bruno, [1, 2, 3, 4, 5], '07:00', 50, 14, 'Estudio');
sched(C.spinning, sanIsidro, bruno, [2, 4], '19:30', 45, 16, 'Estudio');
sched(C.yoga, sanIsidro, bruno, [6], '09:30', 60, 14, 'Estudio');

// ------------------------------------------------------------- ejercicios
const EX: [string, string, string][] = [
  ['Press de banca', 'pecho', 'barra'], ['Press inclinado con mancuernas', 'pecho', 'mancuernas'], ['Aperturas en polea', 'pecho', 'polea'],
  ['Fondos en paralelas', 'pecho', 'peso corporal'], ['Flexiones', 'pecho', 'peso corporal'],
  ['Dominadas', 'espalda', 'peso corporal'], ['Remo con barra', 'espalda', 'barra'], ['Jalón al pecho', 'espalda', 'polea'],
  ['Remo con mancuerna', 'espalda', 'mancuernas'], ['Peso muerto', 'espalda', 'barra'],
  ['Sentadilla', 'piernas', 'barra'], ['Prensa de piernas', 'piernas', 'máquina'], ['Zancadas', 'piernas', 'mancuernas'],
  ['Extensión de cuádriceps', 'piernas', 'máquina'], ['Curl femoral', 'piernas', 'máquina'], ['Sentadilla búlgara', 'piernas', 'mancuernas'],
  ['Hip thrust', 'gluteos', 'barra'], ['Patada de glúteo en polea', 'gluteos', 'polea'], ['Puente de glúteo', 'gluteos', 'peso corporal'],
  ['Press militar', 'hombros', 'barra'], ['Elevaciones laterales', 'hombros', 'mancuernas'], ['Face pull', 'hombros', 'polea'], ['Press Arnold', 'hombros', 'mancuernas'],
  ['Curl con barra', 'biceps', 'barra'], ['Curl martillo', 'biceps', 'mancuernas'], ['Curl en banco Scott', 'biceps', 'máquina'],
  ['Extensión en polea', 'triceps', 'polea'], ['Press francés', 'triceps', 'barra Z'], ['Fondos en banco', 'triceps', 'peso corporal'],
  ['Plancha', 'core', 'peso corporal'], ['Rueda abdominal', 'core', 'rueda'], ['Pallof press', 'core', 'polea'], ['Elevación de piernas colgado', 'core', 'barra fija'],
  ['Remo ergómetro', 'cardio', 'máquina'], ['Bicicleta de asalto', 'cardio', 'máquina'], ['Cinta inclinada', 'cardio', 'máquina'], ['Salto de cuerda', 'cardio', 'cuerda'],
  ['Burpees', 'cuerpo_completo', 'peso corporal'], ['Kettlebell swing', 'cuerpo_completo', 'kettlebell'], ['Thruster', 'cuerpo_completo', 'barra'],
];
const exId: Record<string, number> = {};
for (const [name, muscle, eq] of EX) exId[name] = insert('INSERT INTO exercises (name, muscle_group, equipment, instructions, created_by) VALUES (?, ?, ?, ?, ?)', [name, muscle, eq, '', renzo]);

type Item = [string, string, number, string, number | null];
const routine = (name: string, goal: string, memberId: number | null, trainer: number, items: Item[], basedOn: number | null = null, created = nowIso) => {
  const id = insert('INSERT INTO routines (name, goal, member_id, trainer_id, based_on_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [name, goal, memberId, trainer, basedOn, created]);
  const pos: Record<string, number> = {};
  for (const [day, ex, sets, reps, kg] of items) {
    pos[day] = (pos[day] ?? 0) + 1;
    insert('INSERT INTO routine_items (routine_id, day_label, position, exercise_id, sets, reps, target_kg, rest_sec) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [id, day, pos[day], exId[ex], sets, reps, kg, sets >= 4 ? 120 : 90]);
  }
  return id;
};
const FUERZA: Item[] = [
  ['A', 'Sentadilla', 4, '5', 60], ['A', 'Press de banca', 4, '5', 45], ['A', 'Remo con barra', 3, '8', 40], ['A', 'Plancha', 3, '45s', null],
  ['B', 'Peso muerto', 3, '5', 70], ['B', 'Press militar', 4, '6', 30], ['B', 'Dominadas', 3, '6-8', null], ['B', 'Pallof press', 3, '12', 10],
  ['C', 'Sentadilla búlgara', 3, '8-10', 12], ['C', 'Press inclinado con mancuernas', 3, '8-10', 16], ['C', 'Jalón al pecho', 3, '10', 45], ['C', 'Hip thrust', 3, '10', 60],
];
const tplFuerza = routine('Fuerza base · 3 días', 'Construir fuerza en básicos con progresión lineal.', null, renzo, FUERZA);
routine('Torso / Pierna · 4 días', 'Hipertrofia con volumen moderado.', null, valeria, [
  ['A', 'Press de banca', 4, '8-10', 40], ['A', 'Remo con mancuerna', 4, '10', 22], ['A', 'Elevaciones laterales', 3, '12-15', 8], ['A', 'Extensión en polea', 3, '12', 20],
  ['B', 'Sentadilla', 4, '8', 55], ['B', 'Curl femoral', 3, '12', 35], ['B', 'Hip thrust', 4, '10', 70], ['B', 'Elevación de piernas colgado', 3, '12', null],
]);
routine('Acondicionamiento general', 'Capacidad aeróbica y resistencia muscular.', null, bruno, [
  ['A', 'Remo ergómetro', 1, '10', null], ['A', 'Kettlebell swing', 4, '15', 16], ['A', 'Thruster', 4, '10', 25], ['A', 'Burpees', 3, '12', null], ['A', 'Rueda abdominal', 3, '10', null],
]);

// ---------------------------------------------------------------- socios
const FIRST_F = ['Lucía', 'María José', 'Camila', 'Valentina', 'Daniela', 'Fiorella', 'Andrea', 'Ximena', 'Rosa', 'Carmen', 'Milagros', 'Alessandra', 'Gabriela', 'Patricia', 'Sofía', 'Ana Lucía', 'Kiara', 'Claudia', 'Mariana', 'Yesenia'];
const FIRST_M = ['Mateo', 'Sebastián', 'Diego', 'José Luis', 'Luis Miguel', 'Renato', 'Joaquín', 'Gonzalo', 'Álvaro', 'Christian', 'Jorge', 'Piero', 'Rodrigo', 'Martín', 'Kevin', 'Fernando', 'Ricardo', 'André', 'Juan Carlos', 'Paolo'];
const LAST = ['Quispe', 'Flores', 'Sánchez', 'Rodríguez', 'García', 'Rojas', 'Mendoza', 'Chávez', 'Torres', 'Ramírez', 'Vargas', 'Castillo', 'Huamán', 'Gutiérrez', 'Díaz', 'Paredes', 'Salazar', 'Cruz', 'Ramos', 'Espinoza', 'Vásquez', 'Mamani', 'Romero', 'Medina', 'Herrera', 'Aguilar', 'Silva', 'Morales', 'Ríos', 'Delgado', 'Navarro', 'Cárdenas', 'Palacios', 'Zamora', 'Valdivia', 'Benavides', 'Tello', 'Carrillo', 'Ponce', 'Arias'];
const HEALTH = [null, null, null, null, 'Lesión antigua de rodilla derecha; evitar impacto alto.', 'Asma leve controlada, trae inhalador.', 'Hipertensión controlada con medicación.', 'Hernia discal L5-S1, sin carga axial pesada.', 'Postoperatorio de hombro (2025), alta médica.'];

const usedDni = new Set<string>();
const newDni = () => { let d: string; do d = String(int(10_000_000, 79_999_999)); while (usedDni.has(d)); usedDni.add(d); return d; };

let receipt = 0;
interface Mem { id: number; memberId: number; start: string; end: string; price: number }
const pay = (memberId: number | null, membershipId: number | null, amount: number, date: string, method: string, concept: string, branch: number, receiver: number, voidIt?: string) => {
  receipt++;
  const paidAt = at(date, int(7, 20), int(0, 59));
  const ref = method === 'transfer' ? `OP-${int(100000, 999999)}` : method === 'card' ? `VISA •${int(1000, 9999)}` : null;
  const id = insert(
    `INSERT INTO payments (receipt_number, member_id, membership_id, concept, amount_cents, method, reference, paid_at, branch_id, received_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [`B001-${String(receipt).padStart(6, '0')}`, memberId, membershipId, concept, amount, method, ref, paidAt < nowIso ? paidAt : nowIso, branch, receiver],
  );
  if (voidIt) {
    run("UPDATE payments SET status = 'voided', voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?", [paidAt < nowIso ? paidAt : nowIso, admin, voidIt, id]);
    insert('INSERT INTO audit_log (actor_id, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)', [admin, 'payment.void', 'payment', id, JSON.stringify({ reason: voidIt }), paidAt < nowIso ? paidAt : nowIso]);
  }
  return id;
};
const methodPick = () => { const r = rnd(); return r < 0.4 ? 'cash' : r < 0.75 ? 'card' : 'transfer'; };
const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

const addMembership = (memberId: number, p: typeof P.mensual, start: string, opts: { paid?: number | 'full'; branch?: number; status?: string } = {}): Mem => {
  const end = addDays(start, p.days - 1);
  const id = insert(
    'INSERT INTO memberships (member_id, plan_id, start_date, end_date, status, list_price_cents, amount_due_cents, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [memberId, p.id, start, end, opts.status ?? 'active', p.price, p.price, recep, at(start <= today ? start : today, 9, 0)],
  );
  const paid = opts.paid === undefined || opts.paid === 'full' ? p.price : opts.paid;
  const planName = one<{ name: string }>('SELECT name FROM plans WHERE id = ?', [p.id])!.name;
  if (paid > 0) pay(memberId, id, paid, start <= today ? start : today, methodPick(), `Plan ${planName} · ${fmt(start)} al ${fmt(end)}`, opts.branch ?? miraflores, recep);
  return { id, memberId, start, end, price: p.price };
};

interface MemberSeed { id: number; branch: number; trainer: number | null; coverage: [string, string][] }
const members: MemberSeed[] = [];
const addMember = (first: string, last: string, opts: { dni?: string; email?: string | null; trainer?: number | null; branch?: number; createdAt?: string; health?: string | null } = {}) => {
  const branch = opts.branch ?? (chance(0.7) ? miraflores : sanIsidro);
  const id = insert(
    `INSERT INTO members (dni, first_name, last_name, email, phone, birth_date, health_notes, emergency_contact, trainer_id, home_branch_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [opts.dni ?? newDni(), first, last,
      opts.email === undefined ? `${first.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.${last.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}${int(1, 99)}@correo.pe` : opts.email,
      `9${int(10, 99)} ${int(100, 999)} ${int(100, 999)}`, `${int(1972, 2006)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
      opts.health === undefined ? pick(HEALTH) : opts.health, `${pick(FIRST_F)} ${pick(LAST)} · 9${int(10, 99)} ${int(100, 999)} ${int(100, 999)}`,
      opts.trainer ?? null, branch, recep, opts.createdAt ?? at(addDays(today, -240), 10, 0)],
  );
  const m: MemberSeed = { id, branch, trainer: opts.trainer ?? null, coverage: [] };
  members.push(m);
  return m;
};

// ---- Casos de demostración con DNI fijo (ver README · "Probar el check-in")
const demoUserId = insert('INSERT INTO users (email, password_hash, role, full_name, branch_id) VALUES (?, ?, ?, ?, ?)', ['socio@gymos.pe', hash, 'member', 'Lucía Ramírez Torres', miraflores]);
const lucia = addMember('Lucía', 'Ramírez Torres', { dni: '70112233', email: 'socio@gymos.pe', trainer: renzo, branch: miraflores, health: 'Lesión antigua de rodilla derecha; evitar impacto alto.' });
run('UPDATE members SET user_id = ? WHERE id = ?', [demoUserId, lucia.id]);
{ // Historia: mensual → trimestral vigente que vence en 5 días
  const t1 = addDays(today, -125);
  addMembership(lucia.id, P.mensual, t1);
  const t2 = addDays(t1, 30);
  const cur = addMembership(lucia.id, P.trimestral, t2); // terminaría hoy-6
  // Un congelamiento pasado de 11 días desplazó el vencimiento a hoy+5.
  insert('INSERT INTO membership_freezes (membership_id, start_date, end_date, reason, created_by) VALUES (?, ?, ?, ?, ?)',
    [cur.id, addDays(t2, 40), addDays(t2, 50), 'Viaje de trabajo a Arequipa', recep]);
  run('UPDATE memberships SET end_date = ? WHERE id = ?', [addDays(today, 5), cur.id]);
  lucia.coverage.push([t1, addDays(today, 5)]);
}

const caseMember = (first: string, last: string, dni: string, setup: (id: number) => [string, string] | null, trainer: number | null = null) => {
  const m = addMember(first, last, { dni, trainer, branch: miraflores });
  const cov = setup(m.id);
  if (cov) m.coverage.push(cov);
  return m;
};
caseMember('Mateo', 'Flores Huamán', '70223344', (id) => { const s = addDays(today, -120); addMembership(id, P.semestral, s); return [s, addDays(s, 179)]; }, valeria); // ACTIVO
caseMember('Camila', 'Rojas Vargas', '70334455', (id) => { const s = addDays(today, -29); addMembership(id, P.mensual, s); return [s, today]; }); // VENCE HOY
caseMember('Sebastián', 'Chávez Díaz', '70445566', (id) => { const s = addDays(today, -32); addMembership(id, P.mensual, s); return [s, addDays(s, 29)]; }); // VENCIDO hace 3 días
caseMember('Valentina', 'Torres Medina', '70556677', (id) => {
  const s = addDays(today, -40); const m = addMembership(id, P.trimestral, s);
  insert('INSERT INTO membership_freezes (membership_id, start_date, end_date, reason, created_by) VALUES (?, ?, ?, ?, ?)', [m.id, addDays(today, -3), addDays(today, 8), 'Reposo médico por esguince de tobillo', recep]);
  run('UPDATE memberships SET end_date = ? WHERE id = ?', [addDays(m.end, 12), m.id]);
  return [s, addDays(m.end, 12)];
}); // CONGELADO
caseMember('Diego', 'Gutiérrez Salazar', '70667788', () => null); // SIN PLAN
caseMember('Fiorella', 'Paredes Cruz', '70778899', (id) => { const s = addDays(today, -10); addMembership(id, P.trimestral, s, { paid: 20000 }); return [s, addDays(s, 89)]; }); // CON DEUDA
caseMember('Joaquín', 'Silva Navarro', '70889900', (id) => { const s = addDays(today, 3); addMembership(id, P.mensual, s); return null; }); // EMPIEZA EN 3 DÍAS

// ---- Población general: historiales de 8 meses con renovaciones y abandonos
for (let i = 0; i < 118; i++) {
  const female = chance(0.52);
  const first = pick(female ? FIRST_F : FIRST_M);
  const last = `${pick(LAST)} ${pick(LAST)}`;
  const join = addDays(today, -int(5, 245));
  const trainer = chance(0.35) ? pick(trainers) : null;
  const m = addMember(first, last, { trainer, createdAt: at(join, 10, 0) });
  let start = join;
  let p = pick(planList);
  const loyalty = rnd(); // probabilidad de renovar
  while (start <= today) {
    const isLast = addDays(start, p.days) > today;
    const partial = isLast && chance(0.08) ? Math.round(p.price * 0.4 / 100) * 100 : 'full';
    const ms = addMembership(m.id, p, start, { paid: partial, branch: m.branch });
    m.coverage.push([ms.start, ms.end]);
    if (!chance(0.55 + loyalty * 0.4)) break; // no renovó
    const gap = chance(0.8) ? 1 : int(2, 12);
    start = addDays(ms.end, gap);
    if (chance(0.25)) p = pick(planList);
  }
  // Algunos renovaron por adelantado (membresía futura ya pagada)
  const lastCov = m.coverage.at(-1);
  if (lastCov && lastCov[1] >= today && lastCov[1] <= addDays(today, 6) && chance(0.35)) {
    const ms = addMembership(m.id, P.mensual, addDays(lastCov[1], 1), { branch: m.branch });
    m.coverage.push([ms.start, ms.end]);
  }
}

// Ventas de pases diarios y un par de anulaciones auditadas
for (let d = 60; d >= 0; d--) {
  const date = addDays(today, -d);
  for (let k = 0; k < (chance(0.5) ? int(1, 3) : 0); k++) {
    const name = `${pick([...FIRST_F, ...FIRST_M])} ${pick(LAST)}`;
    const pid = pay(null, null, 2500, date, chance(0.6) ? 'cash' : 'card', `Pase diario · ${name}`, miraflores, recep);
    insert("INSERT INTO guest_visits (full_name, kind, branch_id, payment_id, created_by, created_at) VALUES (?, 'day_pass', ?, ?, ?, ?)", [name, miraflores, pid, recep, at(date, 12, 0)]);
  }
}
pay(null, null, 2500, addDays(today, -6), 'cash', 'Pase diario · Registro duplicado', miraflores, recep, 'Cobro duplicado por error de digitación');
{
  const target = members[20];
  pay(target.id, null, 4500, addDays(today, -12), 'card', 'Botella y toalla oficiales', miraflores, recep, 'El socio devolvió los productos sin uso');
}
insert("INSERT INTO guest_visits (full_name, phone, kind, branch_id, notes, created_by, created_at) VALUES ('Paola Benavides', '987 111 222', 'tour', ?, 'Interesada en plan trimestral, volver a llamar el viernes.', ?, ?)", [miraflores, recep, at(today, 11, 15)]);
insert("INSERT INTO guest_visits (full_name, phone, kind, branch_id, notes, created_by, created_at) VALUES ('Hugo Carrillo Arias', '956 234 876', 'trial', ?, 'Clase de prueba de Box.', ?, ?)", [miraflores, recep, at(today, 9, 40)]);

// ---------------------------------------------------------------- visitas
const HOURS = [5, 6, 6, 6, 7, 7, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 16, 17, 17, 18, 18, 18, 19, 19, 19, 19, 20, 20, 20, 21];
for (const m of members) {
  const freq = 0.15 + rnd() * 0.5;
  const prefHour = pick(HOURS);
  for (let d = 75; d >= 0; d--) {
    const date = addDays(today, -d);
    const covered = m.coverage.some(([s, e]) => s <= date && date <= e);
    const wd = weekdayOf(date);
    const p = wd === 7 ? freq * 0.35 : wd === 6 ? freq * 0.6 : freq;
    if (!covered || !chance(p)) continue;
    const hour = chance(0.7) ? prefHour : pick(HOURS);
    const t = at(date, hour, int(0, 59));
    if (t > nowIso) continue;
    insert("INSERT INTO visits (member_id, branch_id, method, result, checked_in_at, created_by) VALUES (?, ?, ?, 'granted', ?, ?)", [m.id, m.branch, chance(0.8) ? 'qr' : 'dni', t, recep]);
  }
}
// Rechazos recientes (socio con plan vencido intentando ingresar)
for (const m of members.filter((x) => x.coverage.length && x.coverage.at(-1)![1] < today).slice(0, 6)) {
  insert("INSERT INTO visits (member_id, branch_id, method, result, reason, checked_in_at, created_by) VALUES (?, ?, 'dni', 'denied', 'EXPIRED', ?, ?)", [m.id, m.branch, at(addDays(today, -int(0, 6)), int(7, 20), int(0, 59)), recep]);
}

// ------------------------------------------------------- sesiones y reservas
generateSessions(addDays(today, -28), 28 + 14);
const sessions = all<{ id: number; starts_at: string; ends_at: string; capacity: number; branch_id: number }>('SELECT id, starts_at, ends_at, capacity, branch_id FROM class_sessions ORDER BY starts_at');
const coveredOn = (m: MemberSeed, iso: string) => { const d = localDate(iso, tz); return m.coverage.some(([s, e]) => s <= d && d <= e); };
const classGoers = members.filter(() => chance(0.55));
for (const s of sessions) {
  const isPast = s.starts_at < nowIso;
  const daysAhead = (Date.parse(s.starts_at) - Date.now()) / 86_400_000;
  if (!isPast && daysAhead > 7) continue;
  const fill = isPast ? 0.45 + rnd() * 0.55 : Math.max(0.1, 0.9 - daysAhead * 0.12) * rnd() + 0.1;
  const want = Math.min(s.capacity, Math.round(s.capacity * fill));
  const pool = classGoers.filter((m) => m.branch === s.branch_id && coveredOn(m, s.starts_at) && m.id !== lucia.id).sort(() => rnd() - 0.5);
  for (const m of pool.slice(0, want)) {
    const status = isPast ? (chance(0.86) ? 'attended' : 'no_show') : 'booked';
    insert('INSERT INTO reservations (session_id, member_id, status, created_at) VALUES (?, ?, ?, ?)', [s.id, m.id, status, new Date(Date.parse(s.starts_at) - int(1, 72) * 3_600_000).toISOString()]);
  }
}
// Una clase de mañana llena con lista de espera; Lucía tiene cupo (si cancela, se promueve al primero).
{
  const target = one<{ id: number; capacity: number; starts_at: string }>(
    'SELECT id, capacity, starts_at FROM class_sessions WHERE branch_id = ? AND starts_at > ? ORDER BY starts_at LIMIT 1',
    [miraflores, new Date(Date.now() + 20 * 3_600_000).toISOString()],
  )!;
  run("DELETE FROM reservations WHERE session_id = ?", [target.id]);
  const pool = members.filter((m) => m.id !== lucia.id && m.branch === miraflores && coveredOn(m, target.starts_at));
  insert("INSERT INTO reservations (session_id, member_id, status, created_at) VALUES (?, ?, 'booked', ?)", [target.id, lucia.id, at(addDays(today, -1), 21, 3)]);
  for (const m of pool.slice(0, target.capacity - 1)) insert("INSERT INTO reservations (session_id, member_id, status, created_at) VALUES (?, ?, 'booked', ?)", [target.id, m.id, at(addDays(today, -1), 21, 30)]);
  pool.slice(target.capacity - 1, target.capacity + 2).forEach((m, i) => {
    const t = at(today, 7, 10 + i * 7);
    insert("INSERT INTO reservations (session_id, member_id, status, waitlist_at, created_at) VALUES (?, ?, 'waitlist', ?, ?)", [target.id, m.id, t, t]);
  });
}
// Próximas reservas de Lucía
for (const s of all<{ id: number }>(
  `SELECT s.id FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id
   WHERE s.branch_id = ? AND s.starts_at > ? AND ct.name IN ('Funcional','Yoga') ORDER BY s.starts_at LIMIT 2`,
  [miraflores, new Date(Date.now() + 26 * 3_600_000).toISOString()],
)) {
  const exists = one('SELECT id FROM reservations WHERE session_id = ? AND member_id = ?', [s.id, lucia.id]);
  const booked = one<{ n: number; cap: number }>("SELECT COUNT(*) n, (SELECT capacity FROM class_sessions WHERE id = ?) cap FROM reservations WHERE session_id = ? AND status = 'booked'", [s.id, s.id])!;
  if (!exists && booked.n < booked.cap) insert("INSERT INTO reservations (session_id, member_id, status, created_at) VALUES (?, ?, 'booked', ?)", [s.id, lucia.id, nowIso]);
}
// Una clase cancelada esta semana
{
  const s = one<{ id: number }>("SELECT id FROM class_sessions WHERE starts_at > ? AND branch_id = ? ORDER BY starts_at LIMIT 1 OFFSET 9", [nowIso, sanIsidro]);
  if (s) {
    run("UPDATE class_sessions SET status = 'cancelled', cancel_reason = 'Mantenimiento del sistema de ventilación' WHERE id = ?", [s.id]);
    run("UPDATE reservations SET status = 'cancelled', cancelled_at = ? WHERE session_id = ? AND status IN ('booked','waitlist')", [nowIso, s.id]);
  }
}

// ---------------------------------------------------- rutinas y progreso
const progressFor = (memberId: number, routineId: number, items: Item[], weeks: number, perWeek: number, strength: number) => {
  const days = [...new Set(items.map((i) => i[0]))];
  let n = 0;
  for (let w = weeks; w >= 0; w--) {
    for (let k = 0; k < perWeek; k++) {
      const date = addDays(today, -w * 7 - (perWeek - k) * 2);
      if (date >= today) continue;
      const day = days[n++ % days.length];
      const start = at(date, int(6, 20), int(0, 50));
      const wid = insert('INSERT INTO workout_sessions (member_id, routine_id, day_label, started_at, finished_at) VALUES (?, ?, ?, ?, ?)', [memberId, routineId, day, start, new Date(Date.parse(start) + 65 * 60_000).toISOString()]);
      for (const [d, ex, sets, reps, kg] of items) {
        if (d !== day) continue;
        const progress = 1 + ((weeks - w) / weeks) * 0.22 * strength;
        const base = kg ?? 0;
        const repsN = Number(reps.replace(/s$/, '').split('-')[0]);
        for (let sn = 1; sn <= sets; sn++) {
          const weight = base ? Math.round((base * progress + (rnd() - 0.5) * 2) / 2.5) * 2.5 : 0;
          insert('INSERT INTO workout_sets (workout_session_id, exercise_id, set_number, reps, weight_kg, rpe, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [wid, exId[ex], sn, Math.max(1, repsN + (sn === sets && chance(0.3) ? -1 : 0) + (chance(0.15) ? 1 : 0)), Math.max(0, weight), chance(0.5) ? int(6, 9) : null, null, start]);
        }
      }
    }
  }
};
const luciaRoutine = routine('Fuerza base · Lucía', 'Fuerza general cuidando la rodilla derecha: sin saltos.', lucia.id, renzo, FUERZA.map((i) => (i[1] === 'Sentadilla' ? ['A', 'Sentadilla', 4, '5', 45] : i[1] === 'Peso muerto' ? ['B', 'Peso muerto', 3, '5', 55] : i[1] === 'Press de banca' ? ['A', 'Press de banca', 4, '5', 30] : i) as Item), tplFuerza, at(addDays(today, -84), 10, 0));
progressFor(lucia.id, luciaRoutine, FUERZA.map((i) => (i[1] === 'Sentadilla' ? ['A', 'Sentadilla', 4, '5', 40] : i[1] === 'Peso muerto' ? ['B', 'Peso muerto', 3, '5', 50] : i[1] === 'Press de banca' ? ['A', 'Press de banca', 4, '5', 27.5] : i[1] === 'Press militar' ? ['B', 'Press militar', 4, '6', 20] : i) as Item), 11, 3, 1.2);
for (let k = 0; k <= 5; k++) {
  const date = addDays(today, -k * 18 - 3);
  insert('INSERT INTO body_measurements (member_id, measured_on, weight_kg, body_fat_pct, chest_cm, waist_cm, hip_cm, arm_cm, thigh_cm, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [lucia.id, date, Math.round((62.8 + k * 0.4) * 10) / 10, Math.round((24 + k * 0.7) * 10) / 10, 89 + (5 - k) * 0.2, 74.5 - (5 - k) * 0.8, 99 - (5 - k) * 0.4, 28 + (5 - k) * 0.25, 56 - (5 - k) * 0.2, renzo]);
}
for (const m of members.filter((x) => x.trainer && x.id !== lucia.id).slice(0, 14)) {
  const items = FUERZA.map((i) => [i[0], i[1], i[2], i[3], i[4] ? Math.round(i[4] * (0.6 + rnd() * 0.8) / 2.5) * 2.5 : null] as Item);
  const rid = routine(`Fuerza base · ${one<{ first_name: string }>('SELECT first_name FROM members WHERE id = ?', [m.id])!.first_name}`, 'Progresión lineal.', m.id, m.trainer!, items, tplFuerza, at(addDays(today, -60), 10, 0));
  progressFor(m.id, rid, items, int(3, 8), int(2, 3), 0.6 + rnd());
  for (let k = 0; k < 3; k++) {
    const w = 58 + rnd() * 35;
    insert('INSERT INTO body_measurements (member_id, measured_on, weight_kg, body_fat_pct, waist_cm, recorded_by) VALUES (?, ?, ?, ?, ?, ?)', [m.id, addDays(today, -k * 25 - 2), Math.round((w - k * 0.6) * 10) / 10, Math.round((18 + rnd() * 14) * 10) / 10, Math.round((70 + rnd() * 25) * 10) / 10, m.trainer]);
  }
}

run('UPDATE receipt_counter SET last = ? WHERE id = 1', [receipt]);
conn.exec('COMMIT');

// Recordatorios del día y avisos de ejemplo para la cuenta demo
markNoShows();
runExpiryReminders();
insert("INSERT INTO notifications (member_id, template_key, title, body, created_at, read_at) VALUES (?, 'payment_received', 'Recibimos tu pago de S/ 429.00', 'Hola Lucía, registramos tu pago de S/ 429.00. Puedes descargar el comprobante desde la app.', ?, ?)",
  [lucia.id, at(addDays(today, -85), 9, 30), at(addDays(today, -85), 10, 0)]);

const counts = one<{ m: number; ms: number; v: number; p: number; s: number; r: number }>(
  `SELECT (SELECT COUNT(*) FROM members) m, (SELECT COUNT(*) FROM memberships) ms, (SELECT COUNT(*) FROM visits) v,
          (SELECT COUNT(*) FROM payments) p, (SELECT COUNT(*) FROM class_sessions) s, (SELECT COUNT(*) FROM reservations) r`,
)!;
console.log(`Seed listo (${today}): ${counts.m} socios · ${counts.ms} membresías · ${counts.v} visitas · ${counts.p} pagos · ${counts.s} sesiones · ${counts.r} reservas`);
console.log(`Cuentas demo (contraseña "${DEMO_PASSWORD}"): admin@gymos.pe · recepcion@gymos.pe · entrenador@gymos.pe · socio@gymos.pe`);

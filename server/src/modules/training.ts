import { z } from 'zod';
import { all, insert, one, run, tx } from '../db/db.ts';
import { route, idParam, isoDate, type AuthUser } from '../lib/http.ts';
import { conflict, forbidden, notFound } from '../lib/errors.ts';
import { clock } from '../lib/clock.ts';
import { getSettings } from '../lib/settings.ts';
import { localDate } from '../lib/dates.ts';
import { assertMemberAccess } from './access-control.ts';
import { todayLocal } from './memberships.ts';

export const MUSCLES = ['pecho', 'espalda', 'piernas', 'gluteos', 'hombros', 'biceps', 'triceps', 'core', 'cardio', 'cuerpo_completo'] as const;

/** 1RM estimado (Epley). Para 1 repetición es el propio peso. */
export function estimate1RM(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0;
  if (reps === 1) return weightKg;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

interface RoutineRow { id: number; name: string; goal: string; member_id: number | null; trainer_id: number | null; based_on_id: number | null; active: number; created_at: string; trainer_name?: string }
interface ItemRow { id: number; routine_id: number; day_label: string; position: number; exercise_id: number; exercise_name: string; muscle_group: string; equipment: string; sets: number; reps: string; target_kg: number | null; rest_sec: number; notes: string | null }

function routineWithItems(id: number) {
  const r = one<RoutineRow>('SELECT r.*, u.full_name trainer_name FROM routines r LEFT JOIN users u ON u.id = r.trainer_id WHERE r.id = ?', [id]);
  if (!r) throw notFound('La rutina');
  const items = all<ItemRow>(
    `SELECT ri.*, e.name exercise_name, e.muscle_group, e.equipment FROM routine_items ri JOIN exercises e ON e.id = ri.exercise_id
     WHERE ri.routine_id = ? ORDER BY ri.day_label, ri.position`, [id],
  );
  const days = [...new Set(items.map((i) => i.day_label))];
  return { ...r, active: !!r.active, isTemplate: r.member_id === null, days, items };
}

function assertRoutineAccess(user: AuthUser, r: { member_id: number | null; trainer_id: number | null }, write: boolean) {
  if (r.member_id === null) {
    if (user.role === 'member' || user.role === 'reception') throw forbidden();
    if (write && user.role === 'trainer' && r.trainer_id !== user.id) throw forbidden('Solo puedes editar tus propias plantillas.');
    return;
  }
  if (write && user.role === 'member') throw forbidden('Tu entrenador gestiona tus rutinas.');
  assertMemberAccess(user, r.member_id, 'training');
}

const itemSchema = z.object({
  dayLabel: z.string().trim().regex(/^[A-F]$/, 'Día A a F'),
  exerciseId: z.number().int().positive(),
  sets: z.number().int().min(1).max(20),
  reps: z.string().trim().regex(/^\d{1,3}(-\d{1,3})?s?$/, 'Ej.: 10, 8-12 o 30s'),
  targetKg: z.number().min(0).max(500).nullable().optional(),
  restSec: z.number().int().min(0).max(600).default(90),
  notes: z.string().trim().max(200).nullable().optional(),
}).strict();

const routineBody = z.object({
  name: z.string().trim().min(3).max(60),
  goal: z.string().trim().max(200).default(''),
  memberId: z.number().int().positive().nullable().default(null),
  items: z.array(itemSchema).min(1, 'Agrega al menos un ejercicio').max(60),
}).strict();

function writeItems(routineId: number, items: z.infer<typeof itemSchema>[]) {
  run('DELETE FROM routine_items WHERE routine_id = ?', [routineId]);
  const pos: Record<string, number> = {};
  for (const it of items) {
    if (!one('SELECT id FROM exercises WHERE id = ?', [it.exerciseId])) throw notFound(`El ejercicio #${it.exerciseId}`);
    pos[it.dayLabel] = (pos[it.dayLabel] ?? 0) + 1;
    insert(
      'INSERT INTO routine_items (routine_id, day_label, position, exercise_id, sets, reps, target_kg, rest_sec, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [routineId, it.dayLabel, pos[it.dayLabel], it.exerciseId, it.sets, it.reps, it.targetKg ?? null, it.restSec, it.notes ?? null],
    );
  }
}

function workoutView(id: number) {
  const w = one<{ id: number; member_id: number; routine_id: number | null; day_label: string | null; started_at: string; finished_at: string | null; notes: string | null; routine_name: string | null }>(
    'SELECT w.*, r.name routine_name FROM workout_sessions w LEFT JOIN routines r ON r.id = w.routine_id WHERE w.id = ?', [id],
  );
  if (!w) throw notFound('La sesión de entrenamiento');
  const sets = all<{ id: number; exercise_id: number; exercise_name: string; set_number: number; reps: number; weight_kg: number; rpe: number | null; created_at: string }>(
    `SELECT s.*, e.name exercise_name FROM workout_sets s JOIN exercises e ON e.id = s.exercise_id WHERE s.workout_session_id = ? ORDER BY s.id`, [id],
  );
  const plan = w.routine_id
    ? all<ItemRow>(`SELECT ri.*, e.name exercise_name, e.muscle_group, e.equipment FROM routine_items ri JOIN exercises e ON e.id = ri.exercise_id
        WHERE ri.routine_id = ? AND ri.day_label = ? ORDER BY ri.position`, [w.routine_id, w.day_label ?? 'A'])
    : [];
  // Referencia de la última vez: mejor serie de cada ejercicio en la sesión anterior del socio.
  const exerciseIds = [...new Set([...plan.map((p) => p.exercise_id), ...sets.map((s) => s.exercise_id)])];
  const previous = Object.fromEntries(exerciseIds.map((eid) => {
    const prev = one<{ weight_kg: number; reps: number; started_at: string }>(
      `SELECT s.weight_kg, s.reps, w.started_at FROM workout_sets s JOIN workout_sessions w ON w.id = s.workout_session_id
       WHERE w.member_id = ? AND s.exercise_id = ? AND w.id <> ? ORDER BY w.started_at DESC, s.weight_kg DESC, s.reps DESC LIMIT 1`,
      [w.member_id, eid, w.id],
    );
    return [eid, prev ?? null];
  }));
  return { ...w, sets, plan, previous };
}

function loadWorkoutFor(user: AuthUser, id: number) {
  const w = one<{ member_id: number; finished_at: string | null }>('SELECT member_id, finished_at FROM workout_sessions WHERE id = ?', [id]);
  if (!w) throw notFound('La sesión de entrenamiento');
  assertMemberAccess(user, w.member_id, 'training');
  return w;
}

const measurementBody = z.object({
  measuredOn: isoDate,
  weightKg: z.number().min(20).max(400).nullable().optional(),
  bodyFatPct: z.number().min(2).max(70).nullable().optional(),
  chestCm: z.number().min(30).max(250).nullable().optional(),
  waistCm: z.number().min(30).max(250).nullable().optional(),
  hipCm: z.number().min(30).max(250).nullable().optional(),
  armCm: z.number().min(10).max(100).nullable().optional(),
  thighCm: z.number().min(20).max(150).nullable().optional(),
}).strict().refine((b) => Object.entries(b).some(([k, v]) => k !== 'measuredOn' && v != null), { message: 'Registra al menos una medida' });

export const trainingRoutes = [
  // ----------------------------------------------------------- ejercicios
  route({
    method: 'get', path: '/exercises', tag: 'Entrenamiento', summary: 'Biblioteca de ejercicios', auth: 'any',
    query: z.object({ muscle: z.enum(MUSCLES).optional(), q: z.string().trim().max(60).optional() }).strict(),
    handler: ({ query }) => all(
      `SELECT * FROM exercises WHERE 1=1 ${query.muscle ? 'AND muscle_group = :muscle' : ''} ${query.q ? 'AND name LIKE :q' : ''} ORDER BY muscle_group, name`,
      { muscle: query.muscle, q: query.q ? `%${query.q}%` : undefined },
    ),
  }),
  route({
    method: 'post', path: '/exercises', tag: 'Entrenamiento', summary: 'Agregar ejercicio a la biblioteca', status: 201, auth: ['trainer', 'admin'],
    body: z.object({
      name: z.string().trim().min(3).max(60),
      muscleGroup: z.enum(MUSCLES),
      equipment: z.string().trim().min(2).max(40),
      instructions: z.string().trim().max(600).default(''),
    }).strict(),
    handler: ({ body, user }) => one('SELECT * FROM exercises WHERE id = ?', [insert(
      'INSERT INTO exercises (name, muscle_group, equipment, instructions, created_by) VALUES (?, ?, ?, ?, ?)',
      [body.name, body.muscleGroup, body.equipment, body.instructions, user.id],
    )]),
  }),
  // ------------------------------------------------------------- rutinas
  route({
    method: 'get', path: '/routines/templates', tag: 'Entrenamiento', summary: 'Plantillas de rutina', auth: ['trainer', 'admin'],
    handler: () => all<RoutineRow>('SELECT r.*, u.full_name trainer_name FROM routines r LEFT JOIN users u ON u.id = r.trainer_id WHERE r.member_id IS NULL AND r.active = 1 ORDER BY r.name')
      .map((r) => routineWithItems(r.id)),
  }),
  route({
    method: 'post', path: '/routines', tag: 'Entrenamiento', summary: 'Crear rutina (plantilla o personalizada)', status: 201, auth: ['trainer', 'admin'],
    body: routineBody,
    handler: ({ body, user }) => tx(() => {
      if (body.memberId) assertMemberAccess(user, body.memberId, 'training');
      const id = insert('INSERT INTO routines (name, goal, member_id, trainer_id, created_at) VALUES (?, ?, ?, ?, ?)',
        [body.name, body.goal, body.memberId, user.id, clock.now().toISOString()]);
      writeItems(id, body.items);
      return routineWithItems(id);
    }),
  }),
  route({
    method: 'get', path: '/routines/:id', tag: 'Entrenamiento', summary: 'Ver rutina', auth: 'any',
    params: idParam,
    handler: ({ params, user }) => {
      const r = routineWithItems(params.id);
      assertRoutineAccess(user, r, false);
      return r;
    },
  }),
  route({
    method: 'put', path: '/routines/:id', tag: 'Entrenamiento', summary: 'Editar rutina', auth: ['trainer', 'admin'],
    params: idParam,
    body: routineBody.omit({ memberId: true }),
    handler: ({ params, body, user }) => tx(() => {
      const r = routineWithItems(params.id);
      assertRoutineAccess(user, r, true);
      run('UPDATE routines SET name = ?, goal = ? WHERE id = ?', [body.name, body.goal, r.id]);
      writeItems(r.id, body.items);
      return routineWithItems(r.id);
    }),
  }),
  route({
    method: 'patch', path: '/routines/:id', tag: 'Entrenamiento', summary: 'Archivar o reactivar rutina', auth: ['trainer', 'admin'],
    params: idParam,
    body: z.object({ active: z.boolean() }).strict(),
    handler: ({ params, body, user }) => {
      const r = routineWithItems(params.id);
      assertRoutineAccess(user, r, true);
      run('UPDATE routines SET active = ? WHERE id = ?', [body.active, r.id]);
      return routineWithItems(r.id);
    },
  }),
  route({
    method: 'post', path: '/routines/:id/assign', tag: 'Entrenamiento', summary: 'Asignar plantilla a un socio (crea una copia editable)', status: 201, auth: ['trainer', 'admin'],
    params: idParam,
    body: z.object({ memberId: z.number().int().positive(), name: z.string().trim().min(3).max(60).optional() }).strict(),
    handler: ({ params, body, user }) => tx(() => {
      const t = routineWithItems(params.id);
      if (!t.isTemplate) throw conflict('NOT_TEMPLATE', 'Solo se asignan plantillas.');
      assertMemberAccess(user, body.memberId, 'training');
      const id = insert('INSERT INTO routines (name, goal, member_id, trainer_id, based_on_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [body.name ?? t.name, t.goal, body.memberId, user.id, t.id, clock.now().toISOString()]);
      writeItems(id, t.items.map((i) => ({ dayLabel: i.day_label, exerciseId: i.exercise_id, sets: i.sets, reps: i.reps, targetKg: i.target_kg, restSec: i.rest_sec, notes: i.notes })));
      return routineWithItems(id);
    }),
  }),
  route({
    method: 'get', path: '/members/:id/routines', tag: 'Entrenamiento', summary: 'Rutinas de un socio', auth: 'any',
    params: idParam,
    handler: ({ params, user }) => {
      assertMemberAccess(user, params.id, 'training');
      return all<{ id: number }>('SELECT id FROM routines WHERE member_id = ? ORDER BY active DESC, created_at DESC', [params.id]).map((r) => routineWithItems(r.id));
    },
  }),
  // ---------------------------------------------------- sesiones (modo entrenando)
  route({
    method: 'post', path: '/members/:id/workouts', tag: 'Entrenamiento', summary: 'Empezar sesión de entrenamiento', status: 201, auth: ['member', 'trainer', 'admin'],
    description: 'Si el socio ya tiene una sesión abierta de hoy, se reanuda en lugar de crear otra.',
    params: idParam,
    body: z.object({ routineId: z.number().int().positive().nullable().optional(), dayLabel: z.string().regex(/^[A-F]$/).optional() }).strict(),
    handler: ({ params, body, user }) => tx(() => {
      assertMemberAccess(user, params.id, 'training');
      if (body.routineId) {
        const r = one<{ member_id: number | null }>('SELECT member_id FROM routines WHERE id = ?', [body.routineId]);
        if (!r || r.member_id !== params.id) throw notFound('La rutina del socio');
      }
      const tz = getSettings().timezone;
      const open = one<{ id: number; started_at: string }>('SELECT id, started_at FROM workout_sessions WHERE member_id = ? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1', [params.id]);
      if (open && localDate(open.started_at, tz) === todayLocal()) return workoutView(open.id);
      if (open) run('UPDATE workout_sessions SET finished_at = ? WHERE id = ?', [open.started_at, open.id]);
      const id = insert('INSERT INTO workout_sessions (member_id, routine_id, day_label, started_at) VALUES (?, ?, ?, ?)',
        [params.id, body.routineId ?? null, body.dayLabel ?? (body.routineId ? 'A' : null), clock.now().toISOString()]);
      return workoutView(id);
    }),
  }),
  route({
    method: 'get', path: '/workouts/:id', tag: 'Entrenamiento', summary: 'Sesión de entrenamiento con plan y referencia anterior', auth: 'any',
    params: idParam,
    handler: ({ params, user }) => { loadWorkoutFor(user, params.id); return workoutView(params.id); },
  }),
  route({
    method: 'post', path: '/workouts/:id/sets', tag: 'Entrenamiento', summary: 'Registrar serie', status: 201, auth: ['member', 'trainer', 'admin'],
    params: idParam,
    body: z.object({
      exerciseId: z.number().int().positive(),
      reps: z.number().int().min(0).max(500),
      weightKg: z.number().min(0).max(1000),
      rpe: z.number().min(1).max(10).nullable().optional(),
    }).strict(),
    handler: ({ params, body, user }) => {
      const w = loadWorkoutFor(user, params.id);
      if (w.finished_at) throw conflict('WORKOUT_FINISHED', 'Esta sesión ya terminó.');
      const n = one<{ n: number }>('SELECT COUNT(*) n FROM workout_sets WHERE workout_session_id = ? AND exercise_id = ?', [params.id, body.exerciseId])!.n;
      insert('INSERT INTO workout_sets (workout_session_id, exercise_id, set_number, reps, weight_kg, rpe, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [params.id, body.exerciseId, n + 1, body.reps, body.weightKg, body.rpe ?? null, user.id, clock.now().toISOString()]);
      return workoutView(params.id);
    },
  }),
  route({
    method: 'delete', path: '/workouts/:id/sets/:setId', tag: 'Entrenamiento', summary: 'Deshacer serie', auth: ['member', 'trainer', 'admin'],
    params: z.object({ id: z.coerce.number().int().positive(), setId: z.coerce.number().int().positive() }).strict(),
    handler: ({ params, user }) => {
      const w = loadWorkoutFor(user, params.id);
      if (w.finished_at) throw conflict('WORKOUT_FINISHED', 'Esta sesión ya terminó.');
      run('DELETE FROM workout_sets WHERE id = ? AND workout_session_id = ?', [params.setId, params.id]);
      return workoutView(params.id);
    },
  }),
  route({
    method: 'post', path: '/workouts/:id/finish', tag: 'Entrenamiento', summary: 'Terminar sesión', auth: ['member', 'trainer', 'admin'],
    params: idParam,
    body: z.object({ notes: z.string().trim().max(500).nullable().optional() }).strict(),
    handler: ({ params, body, user }) => {
      const w = loadWorkoutFor(user, params.id);
      if (w.finished_at) throw conflict('WORKOUT_FINISHED', 'Esta sesión ya terminó.');
      run('UPDATE workout_sessions SET finished_at = ?, notes = ? WHERE id = ?', [clock.now().toISOString(), body.notes ?? null, params.id]);
      const v = workoutView(params.id);
      const volume = v.sets.reduce((s, x) => s + x.reps * x.weight_kg, 0);
      return { ...v, summary: { sets: v.sets.length, volumeKg: Math.round(volume), exercises: new Set(v.sets.map((s) => s.exercise_id)).size } };
    },
  }),
  route({
    method: 'get', path: '/members/:id/workouts', tag: 'Entrenamiento', summary: 'Historial de entrenamientos', auth: 'any',
    params: idParam,
    handler: ({ params, user }) => {
      assertMemberAccess(user, params.id, 'training');
      return all(
        `SELECT w.id, w.started_at, w.finished_at, w.day_label, r.name routine_name, COUNT(s.id) sets, IFNULL(SUM(s.reps * s.weight_kg), 0) volume_kg
         FROM workout_sessions w LEFT JOIN routines r ON r.id = w.routine_id LEFT JOIN workout_sets s ON s.workout_session_id = w.id
         WHERE w.member_id = ? GROUP BY w.id ORDER BY w.started_at DESC LIMIT 60`, [params.id],
      );
    },
  }),
  // -------------------------------------------------------------- progreso
  route({
    method: 'get', path: '/members/:id/progress/exercises', tag: 'Entrenamiento', summary: 'Ejercicios con historial y mejor marca', auth: 'any',
    params: idParam,
    handler: ({ params, user }) => {
      assertMemberAccess(user, params.id, 'training');
      const rows = all<{ exercise_id: number; name: string; muscle_group: string; sessions: number; last: string; weight_kg: number; reps: number }>(
        `SELECT s.exercise_id, e.name, e.muscle_group, COUNT(DISTINCT w.id) sessions, MAX(w.started_at) last, s.weight_kg, s.reps
         FROM workout_sets s JOIN workout_sessions w ON w.id = s.workout_session_id JOIN exercises e ON e.id = s.exercise_id
         WHERE w.member_id = ? GROUP BY s.exercise_id ORDER BY sessions DESC, e.name`, [params.id],
      );
      return rows.map((r) => {
        const best = one<{ e: number }>(
          `SELECT MAX(s.weight_kg * (1 + s.reps / 30.0)) e FROM workout_sets s JOIN workout_sessions w ON w.id = s.workout_session_id
           WHERE w.member_id = ? AND s.exercise_id = ? AND s.reps > 0`, [params.id, r.exercise_id],
        )!.e ?? 0;
        return { exerciseId: r.exercise_id, name: r.name, muscleGroup: r.muscle_group, sessions: r.sessions, lastAt: r.last, best1RM: Math.round(best * 10) / 10 };
      });
    },
  }),
  route({
    method: 'get', path: '/members/:id/progress/exercises/:exerciseId', tag: 'Entrenamiento', summary: 'Evolución de un ejercicio (serie temporal)', auth: 'any',
    params: z.object({ id: z.coerce.number().int().positive(), exerciseId: z.coerce.number().int().positive() }).strict(),
    handler: ({ params, user }) => {
      assertMemberAccess(user, params.id, 'training');
      const ex = one<{ id: number; name: string; muscle_group: string }>('SELECT id, name, muscle_group FROM exercises WHERE id = ?', [params.exerciseId]);
      if (!ex) throw notFound('El ejercicio');
      const sets = all<{ workout_id: number; started_at: string; reps: number; weight_kg: number }>(
        `SELECT w.id workout_id, w.started_at, s.reps, s.weight_kg FROM workout_sets s JOIN workout_sessions w ON w.id = s.workout_session_id
         WHERE w.member_id = ? AND s.exercise_id = ? ORDER BY w.started_at, s.id`, [params.id, params.exerciseId],
      );
      const tz = getSettings().timezone;
      const byWorkout = new Map<number, typeof sets>();
      for (const s of sets) byWorkout.set(s.workout_id, [...(byWorkout.get(s.workout_id) ?? []), s]);
      const points = [...byWorkout.values()].map((ss) => {
        const top = ss.reduce((a, b) => (b.weight_kg > a.weight_kg || (b.weight_kg === a.weight_kg && b.reps > a.reps) ? b : a));
        return {
          date: localDate(ss[0].started_at, tz),
          topWeightKg: top.weight_kg,
          topReps: top.reps,
          e1rm: Math.max(...ss.map((s) => estimate1RM(s.weight_kg, s.reps))),
          volumeKg: Math.round(ss.reduce((v, s) => v + s.reps * s.weight_kg, 0)),
          sets: ss.length,
        };
      });
      return { exercise: ex, points };
    },
  }),
  route({
    method: 'get', path: '/members/:id/measurements', tag: 'Entrenamiento', summary: 'Medidas corporales', auth: 'any',
    params: idParam,
    handler: ({ params, user }) => {
      assertMemberAccess(user, params.id, 'training');
      return all(`SELECT m.*, u.full_name recorded_by_name FROM body_measurements m LEFT JOIN users u ON u.id = m.recorded_by
                  WHERE m.member_id = ? ORDER BY m.measured_on`, [params.id]);
    },
  }),
  route({
    method: 'post', path: '/members/:id/measurements', tag: 'Entrenamiento', summary: 'Registrar medidas corporales', status: 201, auth: ['member', 'trainer', 'admin'],
    params: idParam,
    body: measurementBody,
    handler: ({ params, body, user }) => {
      assertMemberAccess(user, params.id, 'training');
      if (body.measuredOn > todayLocal()) throw conflict('FUTURE_DATE', 'La fecha no puede ser futura.');
      const id = insert(
        `INSERT INTO body_measurements (member_id, measured_on, weight_kg, body_fat_pct, chest_cm, waist_cm, hip_cm, arm_cm, thigh_cm, recorded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [params.id, body.measuredOn, body.weightKg ?? null, body.bodyFatPct ?? null, body.chestCm ?? null, body.waistCm ?? null,
          body.hipCm ?? null, body.armCm ?? null, body.thighCm ?? null, user.id],
      );
      return one('SELECT * FROM body_measurements WHERE id = ?', [id]);
    },
  }),
  // ------------------------------------------------------------ entrenador
  route({
    method: 'get', path: '/trainer/members', tag: 'Entrenamiento', summary: 'Mis socios asignados con actividad reciente', auth: ['trainer', 'admin'],
    query: z.object({ trainerId: z.coerce.number().int().positive().optional() }).strict(),
    handler: ({ user, query }) => {
      const trainerId = user.role === 'trainer' ? user.id : query.trainerId ?? user.id;
      return all(
        `SELECT m.id, m.first_name || ' ' || m.last_name full_name, m.phone,
           (SELECT MAX(started_at) FROM workout_sessions WHERE member_id = m.id) last_workout,
           (SELECT COUNT(*) FROM workout_sessions WHERE member_id = m.id AND started_at >= date('now','-30 days')) workouts_30d,
           (SELECT name FROM routines WHERE member_id = m.id AND active = 1 ORDER BY created_at DESC LIMIT 1) routine_name,
           (SELECT MAX(checked_in_at) FROM visits WHERE member_id = m.id AND result = 'granted') last_visit,
           (SELECT weight_kg FROM body_measurements WHERE member_id = m.id AND weight_kg IS NOT NULL ORDER BY measured_on DESC LIMIT 1) last_weight
         FROM members m WHERE m.trainer_id = ? ORDER BY last_workout IS NULL, last_workout DESC`, [trainerId],
      );
    },
  }),
];

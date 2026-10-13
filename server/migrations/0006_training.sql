-- 0006 · Entrenamiento: ejercicios, rutinas, sesiones de entrenamiento, series y medidas
CREATE TABLE exercises (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  muscle_group  TEXT NOT NULL CHECK (muscle_group IN ('pecho','espalda','piernas','gluteos','hombros','biceps','triceps','core','cardio','cuerpo_completo')),
  equipment     TEXT NOT NULL DEFAULT 'libre',
  instructions  TEXT NOT NULL DEFAULT '',
  created_by    INTEGER REFERENCES users(id)
);

-- member_id NULL = plantilla reutilizable
CREATE TABLE routines (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  goal         TEXT NOT NULL DEFAULT '',
  member_id    INTEGER REFERENCES members(id),
  trainer_id   INTEGER REFERENCES users(id),
  based_on_id  INTEGER REFERENCES routines(id),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_routines_member ON routines(member_id);

CREATE TABLE routine_items (
  id            INTEGER PRIMARY KEY,
  routine_id    INTEGER NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  day_label     TEXT NOT NULL DEFAULT 'A',
  position      INTEGER NOT NULL,
  exercise_id   INTEGER NOT NULL REFERENCES exercises(id),
  sets          INTEGER NOT NULL CHECK (sets BETWEEN 1 AND 20),
  reps          TEXT NOT NULL,           -- "8-10", "12", "30s"
  target_kg     REAL,
  rest_sec      INTEGER NOT NULL DEFAULT 90,
  notes         TEXT
);
CREATE INDEX idx_routine_items ON routine_items(routine_id, day_label, position);

CREATE TABLE workout_sessions (
  id           INTEGER PRIMARY KEY,
  member_id    INTEGER NOT NULL REFERENCES members(id),
  routine_id   INTEGER REFERENCES routines(id),
  day_label    TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  notes        TEXT
);
CREATE INDEX idx_workouts_member ON workout_sessions(member_id, started_at);

CREATE TABLE workout_sets (
  id                  INTEGER PRIMARY KEY,
  workout_session_id  INTEGER NOT NULL REFERENCES workout_sessions(id) ON DELETE CASCADE,
  exercise_id         INTEGER NOT NULL REFERENCES exercises(id),
  set_number          INTEGER NOT NULL CHECK (set_number > 0),
  reps                INTEGER NOT NULL CHECK (reps >= 0 AND reps <= 500),
  weight_kg           REAL NOT NULL DEFAULT 0 CHECK (weight_kg >= 0 AND weight_kg <= 1000),
  rpe                 REAL CHECK (rpe IS NULL OR (rpe >= 1 AND rpe <= 10)),
  recorded_by         INTEGER REFERENCES users(id),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_sets_exercise ON workout_sets(exercise_id);
CREATE INDEX idx_sets_session ON workout_sets(workout_session_id);

CREATE TABLE body_measurements (
  id            INTEGER PRIMARY KEY,
  member_id     INTEGER NOT NULL REFERENCES members(id),
  measured_on   TEXT NOT NULL,
  weight_kg     REAL CHECK (weight_kg IS NULL OR weight_kg BETWEEN 20 AND 400),
  body_fat_pct  REAL CHECK (body_fat_pct IS NULL OR body_fat_pct BETWEEN 2 AND 70),
  chest_cm      REAL,
  waist_cm      REAL,
  hip_cm        REAL,
  arm_cm        REAL,
  thigh_cm      REAL,
  recorded_by   INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_measurements_member ON body_measurements(member_id, measured_on);

-- 0004 · Clases: tipos, horario semanal, sesiones concretas y reservas
CREATE TABLE class_types (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  intensity    INTEGER NOT NULL DEFAULT 2 CHECK (intensity BETWEEN 1 AND 3)
);

-- Plantilla semanal configurada por admin. weekday: 1 = lunes … 7 = domingo
CREATE TABLE class_schedules (
  id             INTEGER PRIMARY KEY,
  class_type_id  INTEGER NOT NULL REFERENCES class_types(id),
  branch_id      INTEGER NOT NULL REFERENCES branches(id),
  trainer_id     INTEGER REFERENCES users(id),
  weekday        INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time     TEXT NOT NULL,          -- HH:MM hora local
  duration_min   INTEGER NOT NULL CHECK (duration_min BETWEEN 15 AND 240),
  capacity       INTEGER NOT NULL CHECK (capacity > 0),
  room           TEXT NOT NULL DEFAULT 'Sala 1',
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
);

CREATE TABLE class_sessions (
  id             INTEGER PRIMARY KEY,
  schedule_id    INTEGER REFERENCES class_schedules(id),
  class_type_id  INTEGER NOT NULL REFERENCES class_types(id),
  branch_id      INTEGER NOT NULL REFERENCES branches(id),
  trainer_id     INTEGER REFERENCES users(id),
  starts_at      TEXT NOT NULL,          -- ISO UTC
  ends_at        TEXT NOT NULL,
  capacity       INTEGER NOT NULL CHECK (capacity > 0),
  room           TEXT NOT NULL DEFAULT 'Sala 1',
  status         TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled')),
  cancel_reason  TEXT,
  UNIQUE (schedule_id, starts_at)
);
CREATE INDEX idx_sessions_start ON class_sessions(starts_at);

CREATE TABLE reservations (
  id             INTEGER PRIMARY KEY,
  session_id     INTEGER NOT NULL REFERENCES class_sessions(id),
  member_id      INTEGER NOT NULL REFERENCES members(id),
  status         TEXT NOT NULL CHECK (status IN ('booked','waitlist','cancelled','attended','no_show')),
  waitlist_at    TEXT,                   -- orden de la lista de espera (FIFO)
  promoted_at    TEXT,                   -- cuándo pasó de espera a reservado
  cancelled_at   TEXT,
  late_cancel    INTEGER NOT NULL DEFAULT 0 CHECK (late_cancel IN (0,1)),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Un socio no puede tener dos reservas vivas para la misma sesión.
CREATE UNIQUE INDEX uq_reservation_live ON reservations(session_id, member_id)
  WHERE status IN ('booked','waitlist','attended');
CREATE INDEX idx_reservations_session ON reservations(session_id, status);

-- Defensa en profundidad: la BD rechaza superar el cupo aunque el servicio fallara.
CREATE TRIGGER reservations_capacity_insert BEFORE INSERT ON reservations
WHEN NEW.status = 'booked' AND
  (SELECT COUNT(*) FROM reservations WHERE session_id = NEW.session_id AND status IN ('booked','attended'))
  >= (SELECT capacity FROM class_sessions WHERE id = NEW.session_id)
BEGIN SELECT RAISE(ABORT, 'CLASS_FULL'); END;

CREATE TRIGGER reservations_capacity_update BEFORE UPDATE OF status ON reservations
WHEN NEW.status = 'booked' AND OLD.status NOT IN ('booked','attended') AND
  (SELECT COUNT(*) FROM reservations WHERE session_id = NEW.session_id AND status IN ('booked','attended'))
  >= (SELECT capacity FROM class_sessions WHERE id = NEW.session_id)
BEGIN SELECT RAISE(ABORT, 'CLASS_FULL'); END;

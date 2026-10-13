-- 0002 · Socios, planes, membresías y congelamientos
CREATE TABLE members (
  id                 INTEGER PRIMARY KEY,
  user_id            INTEGER UNIQUE REFERENCES users(id),
  dni                TEXT NOT NULL UNIQUE,
  first_name         TEXT NOT NULL,
  last_name          TEXT NOT NULL,
  email              TEXT COLLATE NOCASE,
  phone              TEXT,
  birth_date         TEXT,
  health_notes       TEXT,              -- dato sensible: solo entrenador asignado y admin
  emergency_contact  TEXT,
  trainer_id         INTEGER REFERENCES users(id),
  home_branch_id     INTEGER REFERENCES branches(id),
  created_by         INTEGER REFERENCES users(id),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_members_name ON members(last_name, first_name);
CREATE INDEX idx_members_trainer ON members(trainer_id);

CREATE TABLE plans (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL UNIQUE,
  description      TEXT NOT NULL DEFAULT '',
  duration_days    INTEGER NOT NULL CHECK (duration_days > 0),
  price_cents      INTEGER NOT NULL CHECK (price_cents >= 0),
  includes_classes INTEGER NOT NULL DEFAULT 1 CHECK (includes_classes IN (0,1)),
  max_freeze_days  INTEGER NOT NULL DEFAULT 0 CHECK (max_freeze_days >= 0),
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Fechas en zona horaria del gimnasio (YYYY-MM-DD). end_date es inclusiva:
-- una membresía que vence hoy permite ingresar hoy.
CREATE TABLE memberships (
  id               INTEGER PRIMARY KEY,
  member_id        INTEGER NOT NULL REFERENCES members(id),
  plan_id          INTEGER NOT NULL REFERENCES plans(id),
  start_date       TEXT NOT NULL,
  end_date         TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','replaced','cancelled')),
  list_price_cents INTEGER NOT NULL CHECK (list_price_cents >= 0),
  credit_cents     INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),  -- crédito por prorrateo
  amount_due_cents INTEGER NOT NULL CHECK (amount_due_cents >= 0),       -- total a cobrar
  replaces_id      INTEGER REFERENCES memberships(id),
  created_by       INTEGER REFERENCES users(id),
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_memberships_member ON memberships(member_id, end_date);
CREATE INDEX idx_memberships_end ON memberships(end_date);

CREATE TABLE membership_freezes (
  id             INTEGER PRIMARY KEY,
  membership_id  INTEGER NOT NULL REFERENCES memberships(id),
  start_date     TEXT NOT NULL,
  end_date       TEXT NOT NULL,          -- inclusiva; se acorta si se reactiva antes
  reason         TEXT NOT NULL CHECK (length(reason) >= 3),
  created_by     INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ended_early_at TEXT,
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_freezes_membership ON membership_freezes(membership_id);

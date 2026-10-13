-- 0001 · Núcleo: sedes, usuarios (personal y cuentas de socios), sesiones de autenticación, configuración
CREATE TABLE branches (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  address     TEXT NOT NULL DEFAULT '',
  opens_at    TEXT NOT NULL DEFAULT '06:00',
  closes_at   TEXT NOT NULL DEFAULT '22:00',
  capacity    INTEGER NOT NULL DEFAULT 120 CHECK (capacity > 0),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Personal (recepción, entrenador, admin) y socios con cuenta comparten la tabla de usuarios.
CREATE TABLE users (
  id              INTEGER PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('member','reception','trainer','admin')),
  full_name       TEXT NOT NULL,
  phone           TEXT,
  branch_id       INTEGER REFERENCES branches(id),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Refresh tokens rotativos; se guarda solo el hash. "family" permite revocar la cadena ante reutilización.
CREATE TABLE refresh_tokens (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  family      TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_refresh_family ON refresh_tokens(family);

CREATE TABLE login_attempts (
  id          INTEGER PRIMARY KEY,
  email       TEXT NOT NULL COLLATE NOCASE,
  ip          TEXT NOT NULL,
  success     INTEGER NOT NULL CHECK (success IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_login_attempts_email ON login_attempts(email, created_at);
CREATE INDEX idx_login_attempts_ip ON login_attempts(ip, created_at);

-- Valores de negocio configurables (JSON). Ver docs/DECISIONES.md
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  INTEGER REFERENCES users(id)
);

-- Auditoría: acciones sensibles y consultas de datos personales (DNI, salud).
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id),
  action      TEXT NOT NULL,
  entity      TEXT NOT NULL,
  entity_id   INTEGER,
  details     TEXT NOT NULL DEFAULT '{}',
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);
-- La auditoría es de solo escritura.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE'); END;
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'AUDIT_IMMUTABLE'); END;

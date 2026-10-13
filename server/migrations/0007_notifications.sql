-- 0007 · Notificaciones in-app, correo saliente y plantillas editables
CREATE TABLE notification_templates (
  key         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  send_email  INTEGER NOT NULL DEFAULT 1 CHECK (send_email IN (0,1)),
  send_inapp  INTEGER NOT NULL DEFAULT 1 CHECK (send_inapp IN (0,1)),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by  INTEGER REFERENCES users(id)
);

CREATE TABLE notifications (
  id           INTEGER PRIMARY KEY,
  member_id    INTEGER NOT NULL REFERENCES members(id),
  template_key TEXT NOT NULL,
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  dedupe_key   TEXT UNIQUE,              -- evita duplicar recordatorios
  read_at      TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_notifications_member ON notifications(member_id, created_at);

-- Bandeja de salida: un proceso la despacha por SMTP o, en desarrollo, la deja visible en Admin › Correo.
CREATE TABLE email_outbox (
  id            INTEGER PRIMARY KEY,
  to_email      TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  template_key  TEXT NOT NULL,
  dedupe_key    TEXT UNIQUE,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at       TEXT
);

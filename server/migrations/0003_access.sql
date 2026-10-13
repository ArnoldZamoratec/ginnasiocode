-- 0003 · Acceso: intentos de ingreso (aceptados y rechazados) y visitas de invitados
CREATE TABLE visits (
  id             INTEGER PRIMARY KEY,
  member_id      INTEGER REFERENCES members(id),
  membership_id  INTEGER REFERENCES memberships(id),
  branch_id      INTEGER NOT NULL REFERENCES branches(id),
  method         TEXT NOT NULL CHECK (method IN ('qr','dni','manual')),
  result         TEXT NOT NULL CHECK (result IN ('granted','denied')),
  reason         TEXT,                 -- código del motivo de rechazo
  checked_in_at  TEXT NOT NULL,
  created_by     INTEGER REFERENCES users(id)
);
CREATE INDEX idx_visits_member ON visits(member_id, checked_in_at);
CREATE INDEX idx_visits_time ON visits(checked_in_at);

CREATE TABLE guest_visits (
  id            INTEGER PRIMARY KEY,
  full_name     TEXT NOT NULL,
  dni           TEXT,
  phone         TEXT,
  kind          TEXT NOT NULL CHECK (kind IN ('day_pass','trial','tour')),
  branch_id     INTEGER NOT NULL REFERENCES branches(id),
  notes         TEXT,
  payment_id    INTEGER,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_guest_visits_created ON guest_visits(created_at);

-- 0005 · Pagos: nunca se borran, solo se anulan (con auditoría)
CREATE TABLE payments (
  id              INTEGER PRIMARY KEY,
  receipt_number  TEXT NOT NULL UNIQUE,
  member_id       INTEGER REFERENCES members(id),
  membership_id   INTEGER REFERENCES memberships(id),
  concept         TEXT NOT NULL,
  amount_cents    INTEGER NOT NULL CHECK (amount_cents > 0),
  method          TEXT NOT NULL CHECK (method IN ('cash','card','transfer')),
  reference       TEXT,
  paid_at         TEXT NOT NULL,
  branch_id       INTEGER REFERENCES branches(id),
  received_by     INTEGER REFERENCES users(id),
  status          TEXT NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','voided')),
  voided_at       TEXT,
  voided_by       INTEGER REFERENCES users(id),
  void_reason     TEXT
);
CREATE INDEX idx_payments_member ON payments(member_id);
CREATE INDEX idx_payments_paid_at ON payments(paid_at);
CREATE INDEX idx_payments_membership ON payments(membership_id);

CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments
BEGIN SELECT RAISE(ABORT, 'PAYMENT_DELETE_FORBIDDEN'); END;

-- Solo se permite la transición valid -> voided (con autor y motivo); el resto es inmutable.
CREATE TRIGGER payments_immutable BEFORE UPDATE ON payments
WHEN OLD.status = 'voided'
  OR NEW.status <> 'voided'
  OR NEW.amount_cents <> OLD.amount_cents
  OR NEW.method <> OLD.method
  OR NEW.paid_at <> OLD.paid_at
  OR NEW.receipt_number <> OLD.receipt_number
  OR IFNULL(NEW.member_id, 0) <> IFNULL(OLD.member_id, 0)
  OR IFNULL(NEW.membership_id, 0) <> IFNULL(OLD.membership_id, 0)
  OR NEW.voided_by IS NULL OR NEW.void_reason IS NULL
BEGIN SELECT RAISE(ABORT, 'PAYMENT_IMMUTABLE'); END;

CREATE TABLE receipt_counter (
  id    INTEGER PRIMARY KEY CHECK (id = 1),
  last  INTEGER NOT NULL
);
INSERT INTO receipt_counter (id, last) VALUES (1, 0);

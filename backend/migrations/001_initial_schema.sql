CREATE TABLE IF NOT EXISTS slots (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  start TIMESTAMPTZ NOT NULL,
  "end" TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT slots_valid_interval CHECK ("end" > start)
);

CREATE INDEX IF NOT EXISTS slots_start_idx ON slots (start, id);
CREATE INDEX IF NOT EXISTS slots_provider_start_idx ON slots (provider, start, id);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bookings_email_created_id_idx ON bookings (LOWER(email), created_at, id);
CREATE INDEX IF NOT EXISTS bookings_slot_status_idx ON bookings (slot_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_confirmed_per_slot_idx
  ON bookings (slot_id) WHERE status = 'confirmed';

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id BIGSERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  request_hash CHAR(64) NOT NULL,
  response_status INTEGER,
  response_body JSONB,
  retry_after INTEGER CHECK (retry_after IS NULL OR retry_after > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT idempotency_status_valid CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599)
);

CREATE TABLE IF NOT EXISTS booking_attempts (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS booking_attempts_email_time_idx ON booking_attempts (email, attempted_at DESC);
CREATE INDEX IF NOT EXISTS booking_attempts_time_idx ON booking_attempts (attempted_at ASC);

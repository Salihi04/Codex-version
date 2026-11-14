import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { pool } from '../database/pool';
import { sha256 } from '../utils/canonicalJson';

export class InvalidResetPayloadError extends Error {
  constructor(message: string) { super(message); this.name = 'InvalidResetPayloadError'; }
}

export interface ApiResult {
  status: number;
  body: Record<string, unknown>;
  retryAfter?: number;
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function applyRateLimit(client: PoolClient, email: string): Promise<number | null> {
  // Serialize attempts for one email across concurrent requests and application instances.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [email]);
  // Remove a bounded batch of expired attempts to keep the persistent limiter
  // from growing without bound. The time index keeps this cleanup inexpensive.
  await client.query(
    `DELETE FROM booking_attempts
      WHERE id IN (
        SELECT id FROM booking_attempts
         WHERE attempted_at <= clock_timestamp() - INTERVAL '1 minute'
         ORDER BY attempted_at ASC
         LIMIT 500
      )`,
  );
  await client.query('INSERT INTO booking_attempts (email, attempted_at) VALUES ($1, clock_timestamp())', [email]);
  const result = await client.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM booking_attempts
      WHERE email = $1 AND attempted_at > clock_timestamp() - INTERVAL '1 minute'`,
    [email],
  );

  if (result.rows[0].count <= 5) return null;
  const secondsResult = await client.query<{ retry_after: number }>(
    `SELECT GREATEST(1, CEIL(EXTRACT(EPOCH FROM (MIN(attempted_at) + INTERVAL '1 minute' - clock_timestamp()))))::int AS retry_after
       FROM booking_attempts
      WHERE email = $1 AND attempted_at > clock_timestamp() - INTERVAL '1 minute'`,
    [email],
  );
  const retryAfter = secondsResult.rows[0].retry_after;
  return retryAfter;
}

async function saveIdempotentResult(
  client: PoolClient,
  key: string | undefined,
  result: ApiResult,
) {
  if (!key) return;
  await client.query(
    'UPDATE idempotency_keys SET response_status = $2, response_body = $3::jsonb, retry_after = $4 WHERE key = $1',
    [key, result.status, JSON.stringify(result.body), result.retryAfter ?? null],
  );
}

async function finish(
  client: PoolClient,
  key: string | undefined,
  result: ApiResult,
): Promise<ApiResult> {
  await saveIdempotentResult(client, key, result);
  await client.query('COMMIT');
  return result;
}

/**
 * Processes the complete booking workflow inside one PostgreSQL transaction.
 * Idempotency is resolved before rate limiting so replayed requests do not
 * consume another attempt. Attempt tracking, validation results and bookings
 * are committed atomically.
 */
export async function createBooking(body: unknown, idempotencyHeader?: string): Promise<ApiResult> {
  const key = idempotencyHeader?.trim() || undefined;
  const requestHash = sha256(body);
  const normalizedBody = isRecord(body) ? body : {};
  const rawEmail = typeof normalizedBody.email === 'string' ? normalizedBody.email.trim() : '';
  const email = rawEmail.toLowerCase();
  const name = typeof normalizedBody.name === 'string' ? normalizedBody.name.trim() : '';
  const slotId = typeof normalizedBody.slot_id === 'string' ? normalizedBody.slot_id : '';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (key) {
      await client.query(
        `INSERT INTO idempotency_keys (key, request_hash)
         VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [key, requestHash],
      );
      const existing = await client.query<{
        request_hash: string;
        response_status: number | null;
        response_body: Record<string, unknown> | null;
        retry_after: number | null;
      }>('SELECT request_hash, response_status, response_body, retry_after FROM idempotency_keys WHERE key = $1 FOR UPDATE', [key]);
      const record = existing.rows[0];

      if (record.request_hash.trim() !== requestHash) {
        // Reusing a key with a different payload is itself a failed booking
        // attempt. Count it against the supplied email, but preserve the
        // contractually specific 422 response for this key-reuse violation.
        if (email) await applyRateLimit(client, email);
        await client.query('COMMIT');
        return { status: 422, body: { error: 'Idempotency-Key was already used with a different request body' } };
      }
      if (record.response_status !== null && record.response_body !== null) {
        await client.query('COMMIT');
        return { status: record.response_status, body: record.response_body, retryAfter: record.retry_after ?? undefined };
      }
    }

    // Failed requests count too. If no non-empty email was supplied, there is no
    // email bucket to charge; normal field validation below returns the 400.
    if (email) {
      const retryAfter = await applyRateLimit(client, email);
      if (retryAfter !== null) {
        return await finish(client, key, {
          status: 429,
          body: { error: 'Too many booking attempts for this email. Please try again later.' },
          retryAfter,
        });
      }
    }

    if (!slotId || !name || !email) {
      return await finish(client, key, { status: 400, body: { error: 'slot_id, name and email are required' } });
    }
    if (!validEmail(email)) {
      return await finish(client, key, { status: 400, body: { error: 'A valid email address is required' } });
    }

    const slotResult = await client.query<{
      id: string;
      start: Date;
      has_started: boolean;
    }>(
      'SELECT id, start, (start <= clock_timestamp()) AS has_started FROM slots WHERE id = $1 FOR UPDATE',
      [slotId],
    );
    const slot = slotResult.rows[0];
    if (!slot) {
      return await finish(client, key, { status: 404, body: { error: 'The requested slot was not found' } });
    }
    if (slot.has_started) {
      return await finish(client, key, { status: 400, body: { error: 'The requested slot has already started' } });
    }

    const alreadyBooked = await client.query(
      "SELECT 1 FROM bookings WHERE slot_id = $1 AND status = 'confirmed' LIMIT 1",
      [slotId],
    );
    if (alreadyBooked.rowCount) {
      return await finish(client, key, { status: 409, body: { error: 'The requested slot is already booked' } });
    }

    const bookingId = randomUUID();
    await client.query('SAVEPOINT booking_insert');
    try {
      const created = await client.query(
        `INSERT INTO bookings (id, slot_id, name, email, status)
         VALUES ($1, $2, $3, $4, 'confirmed')
         RETURNING id, slot_id, name, email, status, created_at`,
        [bookingId, slotId, name, email],
      );
      return await finish(client, key, { status: 201, body: created.rows[0] });
    } catch (error) {
      const pgError = error as { code?: string };
      if (pgError.code === '23505') {
        await client.query('ROLLBACK TO SAVEPOINT booking_insert');
        return await finish(client, key, { status: 409, body: { error: 'The requested slot is already booked' } });
      }
      throw error;
    }
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* connection may already be in an error state */ }
    throw error;
  } finally {
    client.release();
  }
}

export async function resetDatabase(slots: unknown): Promise<void> {
  if (!Array.isArray(slots)) throw new InvalidResetPayloadError('slots must be an array');
  const normalized = slots.map((slot, index) => {
    if (!isRecord(slot)) throw new InvalidResetPayloadError(`slots[${index}] must be an object`);
    const { id, provider, start, end } = slot;
    if (![id, provider, start, end].every((value) => typeof value === 'string' && value.trim())) {
      throw new InvalidResetPayloadError(`slots[${index}] must include id, provider, start and end`);
    }
    if (Number.isNaN(Date.parse(start as string)) || Number.isNaN(Date.parse(end as string))) {
      throw new InvalidResetPayloadError(`slots[${index}] must contain valid date-time values`);
    }
    if (Date.parse(end as string) <= Date.parse(start as string)) {
      throw new InvalidResetPayloadError(`slots[${index}] end must be later than start`);
    }
    return { id: id as string, provider: provider as string, start, end };
  });

  const ids = normalized.map((slot) => slot.id);
  if (new Set(ids).size !== ids.length) throw new InvalidResetPayloadError('slot ids must be unique');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM bookings');
    await client.query('DELETE FROM idempotency_keys');
    await client.query('DELETE FROM booking_attempts');
    await client.query('DELETE FROM slots');
    for (const slot of normalized) {
      await client.query(
        'INSERT INTO slots (id, provider, start, "end") VALUES ($1, $2, $3, $4)',
        [slot.id, slot.provider, slot.start, slot.end],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listSlots(provider?: string) {
  const result = await pool.query(
    `SELECT s.id, s.provider, s.start, s."end",
            NOT EXISTS (
              SELECT 1 FROM bookings b
               WHERE b.slot_id = s.id AND b.status = 'confirmed'
            ) AS available
       FROM slots s
       ${provider === undefined ? '' : 'WHERE s.provider = $1'}
      ORDER BY s.start ASC, s.id ASC`,
    provider === undefined ? [] : [provider],
  );
  return result.rows;
}

export async function getBooking(id: string) {
  const result = await pool.query(
    'SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = $1',
    [id],
  );
  return result.rows[0] ?? null;
}

export async function cancelBooking(id: string): Promise<ApiResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query(
      'SELECT id, slot_id, name, email, status, created_at FROM bookings WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!found.rowCount) {
      await client.query('COMMIT');
      return { status: 404, body: { error: 'Booking was not found' } };
    }
    if (found.rows[0].status === 'cancelled') {
      await client.query('COMMIT');
      return { status: 409, body: { error: 'Booking has already been cancelled' } };
    }
    const updated = await client.query(
      `UPDATE bookings SET status = 'cancelled'
        WHERE id = $1
        RETURNING id, slot_id, name, email, status, created_at`,
      [id],
    );
    await client.query('COMMIT');
    return { status: 200, body: updated.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listBookings(email: string, limit: number, cursor?: { created_at: string; id: string }) {
  const values: unknown[] = [email.trim().toLowerCase()];
  let cursorClause = '';
  if (cursor) {
    values.push(cursor.created_at, cursor.id);
    cursorClause = `AND (created_at, id) > ($${values.length - 1}::timestamptz, $${values.length}::text)`;
  }
  values.push(limit + 1);
  const result = await pool.query(
    `SELECT id, slot_id, name, email, status,
            to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
       FROM bookings
      WHERE LOWER(email) = $1 ${cursorClause}
      ORDER BY bookings.created_at ASC, bookings.id ASC
      LIMIT $${values.length}`,
    values,
  );
  const hasMore = result.rows.length > limit;
  const bookings = hasMore ? result.rows.slice(0, limit) : result.rows;
  return { bookings, hasMore };
}

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
describe.skipIf(!testDatabaseUrl)('Clinic Booking API (requires a dedicated TEST_DATABASE_URL)', () => {
  const apiKey = 'clinic-assessment-test-key';
  let app: typeof import('../src/app').app;
  let pool: typeof import('../src/database/pool').pool;
  let api: ReturnType<typeof supertest>;

  const futureSlots = [
    { id: 'slot-a', provider: 'Dr Ade', start: '2099-12-10T09:00:00.000Z', end: '2099-12-10T09:30:00.000Z' },
    { id: 'slot-b', provider: 'Dr Bello', start: '2099-12-10T10:00:00.000Z', end: '2099-12-10T10:30:00.000Z' },
    { id: 'slot-c', provider: 'Dr Ade', start: '2099-12-10T11:00:00.000Z', end: '2099-12-10T11:30:00.000Z' },
  ];

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl!;
    process.env.API_KEY = apiKey;
    process.env.NODE_ENV = 'test';
    const poolModule = await import('../src/database/pool');
    pool = poolModule.pool;
    const migration = fs.readFileSync(path.resolve(process.cwd(), 'migrations/001_initial_schema.sql'), 'utf8');
    await pool.query(migration);
    const appModule = await import('../src/app');
    app = appModule.app;
    api = supertest(app);
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM bookings');
    await pool.query('DELETE FROM idempotency_keys');
    await pool.query('DELETE FROM booking_attempts');
    await pool.query('DELETE FROM slots');
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  const auth = { 'X-API-Key': apiKey };
  const reset = (slots = futureSlots) => api.post('/reset').set(auth).send({ slots });
  const makeBooking = (slot_id: string, email = 'ada@example.com', name = 'Ada Obi', key?: string) => {
    let call = api.post('/bookings').set(auth).send({ slot_id, name, email });
    if (key) call = call.set('Idempotency-Key', key);
    return call;
  };

  it('requires the API key on every assessment endpoint', async () => {
    expect((await api.get('/slots')).status).toBe(401);
    expect((await api.get('/slots').set('X-API-Key', 'wrong')).status).toBe(401);
    expect((await api.get('/slots').set(auth)).status).toBe(200);
    // The API key check runs before body parsing, including malformed JSON.
    expect((await api.post('/reset').set('Content-Type', 'application/json').send('{')).status).toBe(401);
  });

  it('resets slots and bookings transactionally, accepts past slots, sorts and exact-filters providers', async () => {
    const seed = [
      { id: 'past', provider: 'Dr Ade', start: '2020-01-01T09:00:00Z', end: '2020-01-01T09:30:00Z' },
      futureSlots[1], futureSlots[0],
    ];
    expect((await reset(seed)).status).toBe(200);
    await makeBooking('slot-b');
    expect((await reset(seed)).status).toBe(200);
    const all = await api.get('/slots').set(auth).expect(200);
    expect(all.body.slots.map((slot: { id: string }) => slot.id)).toEqual(['past', 'slot-a', 'slot-b']);
    expect(all.body.slots.every((slot: { available: boolean }) => slot.available)).toBe(true);
    const exact = await api.get('/slots?provider=Dr%20Ade').set(auth).expect(200);
    expect(exact.body.slots.map((slot: { id: string }) => slot.id)).toEqual(['past', 'slot-a']);
    expect((await api.get('/slots?provider=dr%20ade').set(auth)).body.slots).toHaveLength(0);
  });

  it('validates booking fields, email, missing slots and started slots', async () => {
    await reset([
      { id: 'old', provider: 'Dr Ade', start: '2020-01-01T09:00:00Z', end: '2020-01-01T09:30:00Z' },
      ...futureSlots,
    ]);
    expect((await api.post('/bookings').set(auth).send({ slot_id: 'slot-a', name: '', email: 'a@b.com' })).status).toBe(400);
    expect((await makeBooking('slot-a', 'not-an-email')).status).toBe(400);
    expect((await makeBooking('missing-slot')).status).toBe(404);
    expect((await makeBooking('old')).status).toBe(400);
  });

  it('creates, retrieves, cancels and releases a booking slot', async () => {
    await reset();
    const created = await makeBooking('slot-a', ' ADA@EXAMPLE.COM ', '  Ada Obi  ').expect(201);
    expect(created.body).toMatchObject({ slot_id: 'slot-a', name: 'Ada Obi', email: 'ada@example.com', status: 'confirmed' });
    expect((await api.get(`/bookings/${created.body.id}`).set(auth)).status).toBe(200);
    expect((await api.get('/slots').set(auth)).body.slots.find((slot: { id: string }) => slot.id === 'slot-a').available).toBe(false);
    const cancelled = await api.delete(`/bookings/${created.body.id}`).set(auth).expect(200);
    expect(cancelled.body.status).toBe('cancelled');
    await api.delete(`/bookings/${created.body.id}`).set(auth).expect(409);
    expect((await api.get('/slots').set(auth)).body.slots.find((slot: { id: string }) => slot.id === 'slot-a').available).toBe(true);
    await api.get('/bookings/no-such-booking').set(auth).expect(404);
  });

  it('prevents two simultaneous confirmed bookings for the same slot', async () => {
    await reset();
    const results = await Promise.all([
      makeBooking('slot-a', 'first@example.com'),
      makeBooking('slot-a', 'second@example.com'),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
  });

  it('replays idempotent responses and rejects key reuse with a different body', async () => {
    await reset();
    const [first, simultaneousReplay] = await Promise.all([
      makeBooking('slot-a', 'ada@example.com', 'Ada Obi', 'same-request-key'),
      makeBooking('slot-a', 'ada@example.com', 'Ada Obi', 'same-request-key'),
    ]);
    expect(first.status).toBe(201);
    expect(simultaneousReplay.status).toBe(201);
    expect(simultaneousReplay.body.id).toBe(first.body.id);
    const replay = await makeBooking('slot-a', 'ada@example.com', 'Ada Obi', 'same-request-key').expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect((await api.get('/slots').set(auth)).body.slots.find((slot: { id: string }) => slot.id === 'slot-a').available).toBe(false);
    await makeBooking('slot-b', 'ada@example.com', 'Ada Obi', 'same-request-key').expect(422);
  });

  it('limits attempts per email and exposes a whole-second Retry-After header', async () => {
    await reset();
    for (let index = 0; index < 5; index += 1) {
      await makeBooking('does-not-exist', 'limited@example.com').expect(404);
    }
    const sixth = await makeBooking('does-not-exist', 'limited@example.com').expect(429);
    expect(Number(sixth.headers['retry-after'])).toBeGreaterThan(0);
    expect(Number.isInteger(Number(sixth.headers['retry-after']))).toBe(true);
    await makeBooking('does-not-exist', 'another@example.com').expect(404);
  });

  it('returns case-insensitive booking history and paginates without duplicate ids', async () => {
    await reset();
    // Use direct inserts with a shared timestamp to prove the tie-breaker is applied.
    const timestamp = '2026-01-01T00:00:00.000Z';
    for (let index = 0; index < 3; index += 1) {
      const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      await pool.query(
        `INSERT INTO bookings (id, slot_id, name, email, status, created_at)
         VALUES ($1, $2, $3, $4, 'confirmed', $5)`,
        [id, futureSlots[index].id, `Patient ${index}`, 'history@example.com', timestamp],
      );
    }
    const first = await api.get('/bookings?email=HISTORY%40EXAMPLE.COM&limit=2').set(auth).expect(200);
    expect(first.body.bookings).toHaveLength(2);
    expect(first.body.next_cursor).toBeTruthy();
    const second = await api.get(`/bookings?email=history%40example.com&limit=2&cursor=${encodeURIComponent(first.body.next_cursor)}`).set(auth).expect(200);
    expect(second.body.bookings).toHaveLength(1);
    expect(second.body.next_cursor).toBeNull();
    const ids = [...first.body.bookings, ...second.body.bookings].map((booking: { id: string }) => booking.id);
    expect(new Set(ids).size).toBe(3);
    await api.get('/bookings?email=history@example.com&limit=0').set(auth).expect(400);
    await api.get('/bookings').set(auth).expect(400);
  });
});

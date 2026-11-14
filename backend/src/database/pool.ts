import { Pool } from 'pg';
import { env } from '../config/env';

export const pool = new Pool({
  connectionString: env.databaseUrl,
  ...(env.databaseSsl ? { ssl: { rejectUnauthorized: true } } : {}),
  max: Number.parseInt(process.env.PG_POOL_MAX ?? '10', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (error) => {
  // A checked-out client is not involved; keep the process alive and let the pool recover.
  console.error('Unexpected PostgreSQL pool error:', error);
});

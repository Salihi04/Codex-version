import fs from 'node:fs';
import path from 'node:path';
import { pool } from './pool';

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    const migrationsDirectory = path.resolve(__dirname, '../../migrations');
    const files = fs.readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql')).sort();

    for (const filename of files) {
      const existing = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
      if (existing.rowCount) {
        console.log(`Already applied: ${filename}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDirectory, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log(`Applied: ${filename}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    console.log('Database migrations are up to date.');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error('Database migration failed:', error);
  process.exitCode = 1;
});

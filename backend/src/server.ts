import { app } from './app';
import { env } from './config/env';
import { pool } from './database/pool';

const server = app.listen(env.port, () => {
  console.log(`Clinic Booking API listening on port ${env.port}`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received; shutting down gracefully`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

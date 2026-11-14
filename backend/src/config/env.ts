import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  get databaseUrl() { return required('DATABASE_URL'); },
  get apiKey() { return required('API_KEY'); },
  port: Number.parseInt(process.env.PORT ?? '3000', 10),
  frontendUrls: (process.env.FRONTEND_URL ?? 'http://localhost:5173')
    .split(',').map((origin) => origin.trim()).filter(Boolean),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseSsl: process.env.DATABASE_SSL === 'true',
};

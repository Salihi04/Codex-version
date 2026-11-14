import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import clinicRoutes from './routes/clinicRoutes';
import { requireApiKey } from './middleware/apiKey';
import { errorHandler, notFound } from './middleware/errorHandler';
import { pool } from './database/pool';
import { sendError } from './utils/http';

export const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || env.frontendUrls.includes(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-API-Key', 'Idempotency-Key'],
  exposedHeaders: ['Retry-After'],
}));
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.status(200).json({ status: 'ok', database: 'connected' });
  } catch {
    return sendError(res, 503, 'Database unavailable');
  }
});
// Authenticate before parsing request bodies so malformed unauthenticated JSON
// still receives the assessment-mandated 401 response.
app.use(requireApiKey);
app.use(express.json({ limit: '1mb' }));
app.use('/', clinicRoutes);
app.use(notFound);
app.use(errorHandler);

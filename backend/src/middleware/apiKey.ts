import { timingSafeEqual } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { sendError } from '../utils/http';

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const supplied = req.header('X-API-Key') ?? '';
  const expected = env.apiKey;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  const valid = suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
  if (!valid) return sendError(res, 401, 'Missing or invalid API key');
  return next();
}

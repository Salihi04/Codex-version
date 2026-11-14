import { ErrorRequestHandler, Request, Response } from 'express';
import { sendError } from '../utils/http';

export const notFound = (req: Request, res: Response) =>
  sendError(res, 404, `Route not found: ${req.method} ${req.path}`);

export const errorHandler: ErrorRequestHandler = (error, _req, res: Response, _next) => {
  if (res.headersSent) return;
  const candidate = error as { status?: number; statusCode?: number; type?: string };
  if (candidate.type === 'entity.parse.failed' || candidate.status === 400 || candidate.statusCode === 400) {
    return sendError(res, 400, 'Request body must contain valid JSON');
  }
  console.error('Unhandled API error:', error);
  return sendError(res, 500, 'An unexpected server error occurred');
};

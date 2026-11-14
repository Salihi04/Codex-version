import { Request, Response } from 'express';
import {
  cancelBooking,
  createBooking,
  getBooking,
  listBookings,
  listSlots,
  resetDatabase,
  InvalidResetPayloadError,
} from '../services/bookingService';
import { decodeCursor, encodeCursor } from '../utils/cursor';
import { sendError } from '../utils/http';

export async function reset(req: Request, res: Response) {
  try {
    await resetDatabase(req.body?.slots);
    return res.status(200).json({ message: 'Reset successful' });
  } catch (error) {
    if (error instanceof InvalidResetPayloadError) return sendError(res, 400, error.message);
    throw error;
  }
}

export async function slots(req: Request, res: Response) {
  const provider = typeof req.query.provider === 'string' ? req.query.provider : undefined;
  const result = await listSlots(provider);
  return res.status(200).json({ slots: result });
}

export async function create(req: Request, res: Response) {
  const result = await createBooking(req.body, req.header('Idempotency-Key'));
  if (result.retryAfter !== undefined) res.setHeader('Retry-After', String(result.retryAfter));
  return res.status(result.status).json(result.body);
}

export async function bookingById(req: Request, res: Response) {
  const booking = await getBooking(req.params.id);
  if (!booking) return sendError(res, 404, 'Booking was not found');
  return res.status(200).json(booking);
}

export async function cancel(req: Request, res: Response) {
  const result = await cancelBooking(req.params.id);
  return res.status(result.status).json(result.body);
}

export async function bookingsByEmail(req: Request, res: Response) {
  const email = typeof req.query.email === 'string' ? req.query.email.trim() : '';
  if (!email) return sendError(res, 400, 'The email query parameter is required');

  const rawLimit = req.query.limit === undefined ? '10' : String(req.query.limit);
  if (!/^\d+$/.test(rawLimit)) return sendError(res, 400, 'limit must be an integer between 1 and 50');
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return sendError(res, 400, 'limit must be an integer between 1 and 50');
  }

  let cursor: ReturnType<typeof decodeCursor> = null;
  if (req.query.cursor !== undefined) {
    if (typeof req.query.cursor !== 'string' || !req.query.cursor) {
      return sendError(res, 400, 'cursor is invalid');
    }
    cursor = decodeCursor(req.query.cursor);
    if (!cursor) return sendError(res, 400, 'cursor is invalid');
  }

  const result = await listBookings(email, limit, cursor ?? undefined);
  const last = result.bookings[result.bookings.length - 1];
  const nextCursor = result.hasMore && last
    ? encodeCursor({ created_at: String(last.created_at), id: last.id })
    : null;
  return res.status(200).json({ bookings: result.bookings, next_cursor: nextCursor });
}

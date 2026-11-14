import type { Booking, BookingPage, Slot } from '../types';

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const API_KEY = import.meta.env.VITE_API_KEY || '';

export class ApiError extends Error {
  status: number;
  retryAfter?: number;

  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('X-API-Key', API_KEY);
  if (options.body) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError('Unable to reach the clinic server. Check your connection and try again.', 0);
  }

  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const retry = response.headers.get('Retry-After');
    throw new ApiError(
      typeof data.error === 'string' ? data.error : `Request failed (${response.status})`,
      response.status,
      retry ? Number(retry) : undefined,
    );
  }
  return data as T;
}

export const clinicApi = {
  async getSlots(provider?: string): Promise<Slot[]> {
    const params = new URLSearchParams();
    if (provider) params.set('provider', provider);
    const query = params.toString();
    const result = await request<{ slots: Slot[] }>(`/slots${query ? `?${query}` : ''}`);
    return result.slots;
  },

  createBooking(
    payload: { slot_id: string; name: string; email: string },
    idempotencyKey: string = crypto.randomUUID()
  ): Promise<Booking> {
    return request<Booking>('/bookings', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify(payload),
    });
  },

  getBooking(id: string): Promise<Booking> {
    return request<Booking>(`/bookings/${encodeURIComponent(id.trim())}`);
  },

  cancelBooking(id: string): Promise<Booking> {
    return request<Booking>(`/bookings/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  getBookings(email: string, limit = 10, cursor?: string | null): Promise<BookingPage> {
    const params = new URLSearchParams({ email, limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return request<BookingPage>(`/bookings?${params.toString()}`);
  },
};
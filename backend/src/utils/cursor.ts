export interface BookingCursor {
  created_at: string;
  id: string;
}

export function encodeCursor(cursor: BookingCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(value: string): BookingCursor | null {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<BookingCursor>;
    if (typeof decoded.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(decoded.created_at) || Number.isNaN(Date.parse(decoded.created_at))) return null;
    if (typeof decoded.id !== 'string' || !decoded.id.trim() || decoded.id.length > 128) return null;
    // Preserve the timestamp text exactly. PostgreSQL stores microseconds, while
    // JavaScript Date only retains milliseconds; rounding here could skip/repeat rows.
    return { created_at: decoded.created_at, id: decoded.id };
  } catch {
    return null;
  }
}

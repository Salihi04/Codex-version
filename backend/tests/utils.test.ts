import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256 } from '../src/utils/canonicalJson';
import { decodeCursor, encodeCursor } from '../src/utils/cursor';

describe('canonical request hashing', () => {
  it('produces the same canonical body hash regardless of object key order', () => {
    expect(sha256({ email: 'a@example.com', name: 'Ada' }))
      .toBe(sha256({ name: 'Ada', email: 'a@example.com' }));
  });

  it('preserves array order while canonicalizing object keys', () => {
    expect(canonicalJson({ values: [1, 2] })).not.toBe(canonicalJson({ values: [2, 1] }));
  });
});

describe('booking cursor encoding', () => {
  const cursor = {
    created_at: '2026-12-10T09:00:00.000000Z',
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  };

  it('round-trips a stable timestamp and UUID pair', () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('rejects malformed and incomplete cursors', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ created_at: cursor.created_at })).toString('base64url'))).toBeNull();
  });
});

// Token + secret helpers for the API layer.

import { randomBytes, timingSafeEqual } from 'node:crypto';

/** A url-safe random share token (≈22 chars from 16 bytes). */
export function makeToken(): string {
  return randomBytes(16).toString('base64url');
}

/** Constant-time string comparison that never throws on length mismatch. */
export function safeEqual(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

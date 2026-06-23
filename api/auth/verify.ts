// POST /api/auth/verify — check an admin key (login). Body: { key }.
// Returns { ok: true } when the key matches ADMIN_KEY, else 401. No session/cookie is
// issued: the client simply keeps the key in localStorage and sends it as a bearer token.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { safeEqual } from '../_lib/tokens';

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const key = (req.body as { key?: unknown })?.key;
  const admin = process.env.ADMIN_KEY;
  if (!admin) return res.status(500).json({ error: 'ADMIN_KEY is not configured.' });
  if (typeof key === 'string' && safeEqual(key, admin)) {
    return res.status(200).json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Invalid key.' });
}

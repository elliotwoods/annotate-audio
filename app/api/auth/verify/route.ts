// POST /api/auth/verify — check an admin key (login). Body: { key }.
// Returns { ok: true } when the key matches ADMIN_KEY, else 401. No session/cookie is
// issued: the client keeps the key in localStorage and sends it as a bearer token.

import { NextResponse, type NextRequest } from 'next/server';
import { safeEqual } from '@server/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { key?: unknown };
  const admin = process.env.ADMIN_KEY;
  if (!admin) return NextResponse.json({ error: 'ADMIN_KEY is not configured.' }, { status: 500 });
  if (typeof body.key === 'string' && safeEqual(body.key, admin)) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ ok: false, error: 'Invalid key.' }, { status: 401 });
}

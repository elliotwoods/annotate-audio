// GET/POST /api/realtime/token?projectId=<id>&cid=<clientId>&token=<share-token>
//
// Ably token-auth endpoint. The browser's Ably client calls this (via authUrl) to obtain a
// short-lived capability token instead of ever seeing the Ably API key. Authorization reuses
// the existing project model: admins (bearer ADMIN_KEY) and edit-token holders get publish +
// subscribe + presence; view-token holders get subscribe + presence only (so view-only links
// are genuinely read-only at the realtime layer too).
//
// Returns 501 when ABLY_API_KEY is unset so the client can degrade to a no-op (no collab).

import { NextResponse, type NextRequest } from 'next/server';
import Ably from 'ably';
import { accessLevel, canView, canEdit } from '@server/auth';
import { readMeta } from '@server/meta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Realtime is not configured.' }, { status: 501 });

  const sp = req.nextUrl.searchParams;
  const projectId = sp.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'projectId required.' }, { status: 400 });

  try {
    const meta = await readMeta(projectId);
    if (!meta) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

    const access = accessLevel(req, meta);
    if (!canView(access)) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });

    const channel = `project:${projectId}`;
    const ops = canEdit(access)
      ? ['publish', 'subscribe', 'presence']
      : ['subscribe', 'presence'];
    const clientId = sp.get('cid') ?? 'anon';

    const rest = new Ably.Rest({ key: apiKey });
    const tokenRequest = await rest.auth.createTokenRequest({
      clientId,
      capability: JSON.stringify({ [channel]: ops }),
    });
    return NextResponse.json(tokenRequest);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;

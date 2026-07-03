// GET/POST /api/realtime/token?projectId=<id>&cid=<clientId>&token=<share-token>
//
// Mints a short-lived Firebase **custom token** the browser uses to sign in to the Realtime
// Database (on a SECONDARY Firebase app, so the primary Google session is untouched). The
// token carries claims { pid, canEdit } that the RTDB security rules enforce:
//   • pid      — scopes the client to a single project's channel.
//   • canEdit  — gates publishing document edits (owners + edit-link holders). View-link
//                holders get a token with canEdit:false, so they can read the channel and
//                announce presence but cannot publish edits (view-only stays read-only at the
//                realtime layer, exactly as the old Ably capability split did).
//
// Authorization reuses the project access model: owner (Firebase ID token) or a per-project
// view/edit share token.

import { NextResponse, type NextRequest } from 'next/server';
import { accessLevel, canView, canEdit, verifyUid } from '@server/auth';
import { readMeta } from '@server/meta';
import { adminAuth } from '@server/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const projectId = sp.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'projectId required.' }, { status: 400 });

  try {
    const meta = await readMeta(projectId);
    if (!meta) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

    const access = await accessLevel(req, meta);
    if (!canView(access)) return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });

    // Owners sign the token as themselves (attributable presence); link holders get a synthetic
    // per-project uid (claims, not uid, carry the capability — so a shared uid is fine).
    const uid = await verifyUid(req);
    const tokenUid = (uid ?? `link:${projectId}`).slice(0, 128);

    const token = await adminAuth().createCustomToken(tokenUid, {
      pid: projectId,
      canEdit: canEdit(access),
    });
    return NextResponse.json({ token });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;

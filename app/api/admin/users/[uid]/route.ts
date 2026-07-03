// /api/admin/users/[uid] — admin-only per-user actions.
//   POST   — body { disabled?: boolean, admin?: boolean } → enable/disable, grant/revoke admin.
//   DELETE — remove the Firebase user (and de-list their email from the allowlist).

import { NextResponse, type NextRequest } from 'next/server';
import { verifyClaims } from '@server/auth';
import { adminAuth } from '@server/firebaseAdmin';
import { removeApproved } from '@server/allowlist';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const claims = await verifyClaims(req);
  if (!claims) return NextResponse.json({ error: 'Sign-in required.' }, { status: 401 });
  if (!claims.admin) return NextResponse.json({ error: 'Admin only.' }, { status: 403 });
  return null;
}

export async function POST(req: NextRequest, { params }: { params: { uid: string } }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => null)) as
      | { disabled?: boolean; admin?: boolean }
      | null;
    if (!body) return NextResponse.json({ error: 'Body required.' }, { status: 400 });

    if (typeof body.disabled === 'boolean') {
      await adminAuth().updateUser(params.uid, { disabled: body.disabled });
    }
    if (typeof body.admin === 'boolean') {
      // Merge, so we don't wipe other custom claims.
      const user = await adminAuth().getUser(params.uid);
      await adminAuth().setCustomUserClaims(params.uid, {
        ...(user.customClaims ?? {}),
        admin: body.admin ? true : undefined,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { uid: string } }) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    // De-list first so a re-created account with the same email isn't silently pre-approved.
    const user = await adminAuth()
      .getUser(params.uid)
      .catch(() => null);
    if (user?.email) await removeApproved(user.email);
    await adminAuth().deleteUser(params.uid);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

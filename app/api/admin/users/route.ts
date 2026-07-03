// /api/admin/users — admin-only user moderation.
//   GET  — list Firebase Auth users (email, name, disabled, created/last-login) + approved
//          flag + count of sets they own.
//   POST — approve an email (add to the invite allowlist). Body: { email }.
//
// Guarded by verifyClaims(...).admin (bootstrap email or custom claim).

import { NextResponse, type NextRequest } from 'next/server';
import { verifyClaims } from '@server/auth';
import { adminAuth } from '@server/firebaseAdmin';
import { listApproved, addApproved } from '@server/allowlist';
import { listKeys, getJSON } from '@server/storage';
import { ADMIN_EMAILS } from '@server/auth';
import type { ProjectMeta } from '@server/meta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Resolve the caller and require admin; returns null response on success, or a 401/403. */
async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const claims = await verifyClaims(req);
  if (!claims) return NextResponse.json({ error: 'Sign-in required.' }, { status: 401 });
  if (!claims.admin) return NextResponse.json({ error: 'Admin only.' }, { status: 403 });
  return null;
}

/** uid → number of sets owned, from a single scan of the project metas. */
async function ownedCounts(): Promise<Map<string, number>> {
  const keys = (await listKeys('projects/')).filter((k) => k.endsWith('/meta.json'));
  const metas = await Promise.all(keys.map((k) => getJSON<ProjectMeta>(k)));
  const counts = new Map<string, number>();
  for (const m of metas) {
    if (m?.ownerUid) counts.set(m.ownerUid, (counts.get(m.ownerUid) ?? 0) + 1);
  }
  return counts;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const [{ users }, approved, counts] = await Promise.all([
      adminAuth().listUsers(1000),
      listApproved(),
      ownedCounts(),
    ]);
    const approvedSet = new Set(approved);
    const rows = users.map((u) => {
      const email = u.email ?? null;
      const isAdmin =
        u.customClaims?.admin === true ||
        (!!email && ADMIN_EMAILS.includes(email.toLowerCase()));
      return {
        uid: u.uid,
        email,
        displayName: u.displayName ?? null,
        disabled: u.disabled,
        admin: isAdmin,
        approved: isAdmin || (!!email && approvedSet.has(email.toLowerCase())),
        createdAt: u.metadata.creationTime ?? null,
        lastSignInAt: u.metadata.lastSignInTime ?? null,
        ownedCount: counts.get(u.uid) ?? 0,
      };
    });
    // Also surface approved emails that have not signed in yet (no user record).
    const knownEmails = new Set(rows.map((r) => r.email?.toLowerCase()).filter(Boolean));
    const pending = approved
      .filter((e) => !knownEmails.has(e))
      .map((email) => ({ email, pending: true as const }));
    return NextResponse.json({ users: rows, pendingInvites: pending });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => null)) as { email?: string } | null;
    const email = body?.email?.trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: 'A valid email is required.' }, { status: 400 });
    }
    const approvedEmails = await addApproved(email);
    return NextResponse.json({ ok: true, approvedEmails }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

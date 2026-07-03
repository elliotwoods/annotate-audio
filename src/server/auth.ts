// Authorization for the API layer.
//
// Two credential kinds:
//   • Firebase ID token — sent as `Authorization: Bearer <token>`. Identifies a signed-in
//     user by uid. A user is the OWNER of any set whose meta.ownerUid matches their uid, with
//     full view/edit/delete and no need for a share token. Any signed-in user may also create
//     new sets (becoming their owner).
//   • Per-project token — `?token=<secret>` query param, matched against the project's
//     viewToken/editToken in meta.json. Lets people without an account open a shared link.
//     The VIEW token grants read-only access to anyone. The EDIT token is an INVITE: an
//     anonymous holder gets view-only; a SIGNED-IN holder is granted edit and (on the write
//     paths) added to meta.editors so they keep edit access without the link.

import type { NextRequest } from 'next/server';
import { writeMeta, type ProjectMeta } from './meta';
import { safeEqual } from './tokens';
import { adminAuth } from './firebaseAdmin';

/** Extract the bearer token (a Firebase ID token) from the Authorization header, if present. */
export function bearer(req: NextRequest): string | null {
  const h = req.headers.get('authorization');
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/**
 * Verify the caller's Firebase ID token and return their uid, or null if there is no token or
 * it is invalid/expired. Never throws.
 */
export async function verifyUid(req: NextRequest): Promise<string | null> {
  const token = bearer(req);
  if (!token) return null;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

/** Pull the `token` query param (private-link secret). */
export function queryToken(req: NextRequest): string | null {
  return req.nextUrl.searchParams.get('token');
}

export type Access = 'owner' | 'edit' | 'view' | null;

/** Pure access computation from an already-resolved uid + share token. The edit token is an
 *  INVITE: it only grants edit to a SIGNED-IN caller (uid present); an anonymous edit-token
 *  holder is downgraded to view (they must sign in to edit). A uid already in `editors`
 *  (invite previously accepted) keeps edit without needing the token. */
export function computeAccess(uid: string | null, token: string | null, meta: ProjectMeta): Access {
  if (uid && uid === meta.ownerUid) return 'owner';
  if (uid && (meta.editors ?? []).includes(uid)) return 'edit';
  if (safeEqual(token, meta.editToken)) return uid ? 'edit' : 'view';
  if (safeEqual(token, meta.viewToken)) return 'view';
  return null;
}

/** Resolve access AND the caller's uid in one pass (one ID-token verification). */
export async function resolveAccess(
  req: NextRequest,
  meta: ProjectMeta,
): Promise<{ access: Access; uid: string | null }> {
  const uid = await verifyUid(req);
  return { access: computeAccess(uid, queryToken(req), meta), uid };
}

/** Resolve the caller's access level for a given project meta. */
export async function accessLevel(req: NextRequest, meta: ProjectMeta): Promise<Access> {
  return (await resolveAccess(req, meta)).access;
}

/**
 * If the caller authenticated via the edit token but isn't yet a persistent editor, add their
 * uid to `meta.editors` and persist it — turning the edit INVITE into lasting membership. Safe
 * to call after any access check; returns the (possibly updated) meta. No-op for owners,
 * existing editors, view-only, and anonymous callers.
 */
export async function acceptInviteIfEligible(
  req: NextRequest,
  meta: ProjectMeta,
): Promise<ProjectMeta> {
  const { access, uid } = await resolveAccess(req, meta);
  if (access !== 'edit' || !uid || uid === meta.ownerUid) return meta;
  const editors = meta.editors ?? [];
  if (editors.includes(uid)) return meta;
  const updated: ProjectMeta = { ...meta, editors: [...editors, uid] };
  await writeMeta(updated);
  return updated;
}

export function canView(access: Access): boolean {
  return access === 'owner' || access === 'edit' || access === 'view';
}

export function canEdit(access: Access): boolean {
  return access === 'owner' || access === 'edit';
}

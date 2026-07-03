// Authorization for the API layer.
//
// Two credential kinds:
//   • Firebase ID token — sent as `Authorization: Bearer <token>`. Identifies a signed-in
//     user by uid. A user is the OWNER of any set whose meta.ownerUid matches their uid, with
//     full view/edit/delete and no need for a share token. Any signed-in user may also create
//     new sets (becoming their owner).
//   • Per-project token — `?token=<secret>` query param, matched against the project's
//     viewToken/editToken in meta.json. Lets people without an account open a shared link.

import type { NextRequest } from 'next/server';
import type { ProjectMeta } from './meta';
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

/** Resolve the caller's access level for a given project meta. */
export async function accessLevel(req: NextRequest, meta: ProjectMeta): Promise<Access> {
  const uid = await verifyUid(req);
  if (uid && uid === meta.ownerUid) return 'owner';
  const token = queryToken(req);
  if (safeEqual(token, meta.editToken)) return 'edit';
  if (safeEqual(token, meta.viewToken)) return 'view';
  return null;
}

export function canView(access: Access): boolean {
  return access === 'owner' || access === 'edit' || access === 'view';
}

export function canEdit(access: Access): boolean {
  return access === 'owner' || access === 'edit';
}

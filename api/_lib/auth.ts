// Authorization for the API layer.
//
// Two credential kinds:
//   • Admin key  — env ADMIN_KEY, sent as `Authorization: Bearer <key>`. Grants create +
//                  full view/edit/list on any project. This is the "verified user".
//   • Per-project token — `?token=<secret>` query param, matched against the project's
//                  viewToken/editToken in meta.json.

import type { VercelRequest } from '@vercel/node';
import type { ProjectMeta } from './meta';
import { safeEqual } from './tokens';

/** Extract the bearer admin key from the Authorization header, if present. */
export function bearer(req: VercelRequest): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/** True if the request carries the configured admin key. */
export function isAdmin(req: VercelRequest): boolean {
  const key = process.env.ADMIN_KEY;
  return !!key && safeEqual(bearer(req), key);
}

/** Pull the `token` query param (private-link secret). */
export function queryToken(req: VercelRequest): string | null {
  const t = req.query.token;
  if (typeof t === 'string') return t;
  if (Array.isArray(t) && typeof t[0] === 'string') return t[0];
  return null;
}

export type Access = 'admin' | 'edit' | 'view' | null;

/** Resolve the caller's access level for a given project meta. */
export function accessLevel(req: VercelRequest, meta: ProjectMeta): Access {
  if (isAdmin(req)) return 'admin';
  const token = queryToken(req);
  if (safeEqual(token, meta.editToken)) return 'edit';
  if (safeEqual(token, meta.viewToken)) return 'view';
  return null;
}

export function canView(access: Access): boolean {
  return access === 'admin' || access === 'edit' || access === 'view';
}

export function canEdit(access: Access): boolean {
  return access === 'admin' || access === 'edit';
}

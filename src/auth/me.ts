// Client view of the signed-in user's ACCESS status (approval + admin), from GET /api/me, plus
// the admin user-moderation calls (GET/POST/DELETE /api/admin/users...).
//
// Approval gates whether a signed-in user may create/own sets (invite-only). It's derived
// server-side from the R2 allowlist + bootstrap-admin emails, so the client must ask the API
// rather than infer it. Cached in a module var with a subscribe signal so App can gate the UI.

import { idToken } from './session';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

export interface MeStatus {
  signedIn: boolean;
  email?: string | null;
  approved: boolean;
  admin: boolean;
}

export interface AdminUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  disabled: boolean;
  admin: boolean;
  approved: boolean;
  createdAt: string | null;
  lastSignInAt: string | null;
  ownedCount: number;
}

const UNKNOWN: MeStatus = { signedIn: false, approved: false, admin: false };

let cached: MeStatus = UNKNOWN;
const subscribers = new Set<() => void>();

export function getMe(): MeStatus {
  return cached;
}

export function subscribeMe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await idToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

/** Refresh /api/me. Fails OPEN on network/error (keeps the last known status) so a flaky API
 *  can't lock a user out; only an explicit {approved:false} downgrades access. */
export async function refreshMe(): Promise<MeStatus> {
  try {
    const res = await fetch(`${API_BASE}/api/me`, { headers: await authHeaders() });
    if (!res.ok) return cached;
    cached = (await res.json()) as MeStatus;
  } catch {
    // keep previous cached value
  }
  for (const cb of subscribers) cb();
  return cached;
}

/** Reset to the anonymous default (on sign-out). */
export function clearMe(): void {
  cached = UNKNOWN;
  for (const cb of subscribers) cb();
}

// ── admin user moderation ───────────────────────────────────────────────────────

export async function adminListUsers(): Promise<{ users: AdminUser[]; pendingInvites: { email: string }[] }> {
  const res = await fetch(`${API_BASE}/api/admin/users`, { headers: await authHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}

export async function adminApproveEmail(email: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/users`, {
    method: 'POST',
    headers: await authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

export async function adminUpdateUser(uid: string, patch: { disabled?: boolean; admin?: boolean }): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(uid)}`, {
    method: 'POST',
    headers: await authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

export async function adminDeleteUser(uid: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(uid)}`, {
    method: 'DELETE',
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

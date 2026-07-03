// Invite-only access allowlist (server-only).
//
// Only approved emails may create/own/edit their OWN sets. Share-link viewing stays open to
// anyone, and an edit invite grants edit on that one set regardless of this list (see
// src/server/auth.ts). Bootstrap admins (ADMIN_EMAILS) are always approved.
//
// Stored as a single JSON doc in R2 at admin/allowlist.json so it lives with the rest of the
// app's state and needs no extra service. Emails are compared case-insensitively.

import { getJSON, putJSON } from './storage';
import { ADMIN_EMAILS } from './auth';

const KEY = 'admin/allowlist.json';

interface AllowlistDoc {
  approvedEmails: string[];
}

/** All explicitly-approved emails (lowercased), excluding the always-on bootstrap admins. */
export async function listApproved(): Promise<string[]> {
  const doc = await getJSON<AllowlistDoc>(KEY);
  return (doc?.approvedEmails ?? []).map((e) => e.toLowerCase());
}

/** Is this email allowed to create/own sets? (Bootstrap admins always are.) */
export async function isApproved(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  const e = email.toLowerCase();
  if (ADMIN_EMAILS.includes(e)) return true;
  return (await listApproved()).includes(e);
}

/** Add an email to the allowlist (idempotent). Returns the updated list. */
export async function addApproved(email: string): Promise<string[]> {
  const e = email.trim().toLowerCase();
  if (!e) return listApproved();
  const list = await listApproved();
  if (!list.includes(e)) list.push(e);
  await putJSON(KEY, { approvedEmails: list });
  return list;
}

/** Remove an email from the allowlist (idempotent). Returns the updated list. */
export async function removeApproved(email: string): Promise<string[]> {
  const e = email.trim().toLowerCase();
  const list = (await listApproved()).filter((x) => x !== e);
  await putJSON(KEY, { approvedEmails: list });
  return list;
}

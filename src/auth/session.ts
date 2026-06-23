// Client-side auth/session state, persisted in localStorage.
//
//   • Admin key — the verified-user secret. Pasted once; kept indefinitely so the user
//     stays "logged in". Sent to the API as a bearer token.
//   • Per-project tokens — view/edit secrets gathered from share links (or returned when
//     the verified user creates/opens a set). Let returning users keep their access.
//
// This module is pure storage + derivation; all network calls live in persistence/cloud.ts.

const ADMIN_KEY = 'aa.adminKey';
const TOKENS_KEY = 'aa.tokens';

export type Access = 'admin' | 'edit' | 'view' | null;

export interface ProjectTokens {
  view?: string;
  edit?: string;
}

type TokenMap = Record<string, ProjectTokens>;

// ── admin key ────────────────────────────────────────────────────────────────

export function getAdminKey(): string | null {
  try {
    return localStorage.getItem(ADMIN_KEY);
  } catch {
    return null;
  }
}

export function setAdminKey(key: string): void {
  try {
    localStorage.setItem(ADMIN_KEY, key);
  } catch {
    /* storage unavailable — verified state simply won't persist */
  }
}

export function clearAdminKey(): void {
  try {
    localStorage.removeItem(ADMIN_KEY);
  } catch {
    /* ignore */
  }
}

export function isVerified(): boolean {
  return !!getAdminKey();
}

// ── per-project tokens ───────────────────────────────────────────────────────

function readTokenMap(): TokenMap {
  try {
    const raw = localStorage.getItem(TOKENS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as TokenMap) : {};
  } catch {
    return {};
  }
}

function writeTokenMap(map: TokenMap): void {
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function getProjectTokens(id: string): ProjectTokens {
  return readTokenMap()[id] ?? {};
}

/** Merge in newly-learned tokens for a project (from a link or a create/open response). */
export function rememberTokens(id: string, tokens: ProjectTokens): void {
  if (!tokens.view && !tokens.edit) return;
  const map = readTokenMap();
  map[id] = { ...map[id], ...tokens };
  writeTokenMap(map);
}

export function forgetTokens(id: string): void {
  const map = readTokenMap();
  if (id in map) {
    delete map[id];
    writeTokenMap(map);
  }
}

// ── derived access ─────────────────────────────────────────────────────────────

/** The caller's effective access to a project: admin > edit > view > null. */
export function accessFor(id: string): Access {
  if (isVerified()) return 'admin';
  const t = getProjectTokens(id);
  if (t.edit) return 'edit';
  if (t.view) return 'view';
  return null;
}

export function canEdit(id: string): boolean {
  const a = accessFor(id);
  return a === 'admin' || a === 'edit';
}

/** The token to send on per-project API calls (prefer edit), or null if admin/none. */
export function tokenFor(id: string): string | null {
  const t = getProjectTokens(id);
  return t.edit ?? t.view ?? null;
}

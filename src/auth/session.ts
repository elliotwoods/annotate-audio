// Client-side auth/session state.
//
//   • User identity — a Firebase Authentication user (Google sign-in). Signing in lets you
//     create and OWN cloud sets; your ID token authorizes the API as the set's owner. Firebase
//     persists the session across reloads, so you stay signed in.
//   • Per-project tokens — view/edit secrets gathered from share links (or echoed back when you
//     create/open a set you own). They let people without an account keep their link access.
//
// This module is identity + per-project token storage; all network calls live in
// persistence/cloud.ts, and the realtime custom-token sign-in lives in persistence/realtime.ts.

import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import { firebaseAuth, hasFirebaseConfig } from './firebase';
import { emitCloudChanged } from './cloudSignal';

const TOKENS_KEY = 'aa.tokens';

export type Access = 'owner' | 'edit' | 'view' | null;

export interface ProjectTokens {
  view?: string;
  edit?: string;
}

type TokenMap = Record<string, ProjectTokens>;

// ── Firebase user identity ─────────────────────────────────────────────────────

let current: User | null = null;
let wired = false;

/** Begin tracking auth state (idempotent). Restores a persisted session asynchronously and
 *  fires emitCloudChanged() when it resolves so cloud-gated UI re-evaluates isVerified(). */
function ensureWired(): void {
  if (wired || typeof window === 'undefined' || !hasFirebaseConfig()) return;
  wired = true;
  onAuthStateChanged(firebaseAuth(), (u) => {
    current = u;
    emitCloudChanged();
  });
}

export function currentUser(): User | null {
  ensureWired();
  return current;
}

/** True when a user is signed in (can create + own cloud sets). */
export function isVerified(): boolean {
  return !!currentUser();
}

/** The signed-in user's Firebase ID token (for `Authorization: Bearer …`), or null. */
export async function idToken(): Promise<string | null> {
  const u = currentUser();
  if (!u) return null;
  try {
    return await u.getIdToken();
  } catch {
    return null;
  }
}

export async function signInWithGoogle(): Promise<void> {
  ensureWired();
  await signInWithPopup(firebaseAuth(), new GoogleAuthProvider());
  emitCloudChanged();
}

export async function signOutUser(): Promise<void> {
  await signOut(firebaseAuth());
  emitCloudChanged();
}

/** Subscribe to sign-in/out changes. Returns an unsubscribe. */
export function onAuthChange(cb: (user: User | null) => void): () => void {
  ensureWired();
  return onAuthStateChanged(firebaseAuth(), cb);
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

/** The caller's effective access to a project from the tokens held locally. Ownership is
 *  resolved server-side from the ID token; in practice an owner holds the edit token after
 *  create/open (the API echoes it back), so token presence is the right client-side signal. */
export function accessFor(id: string): Access {
  const t = getProjectTokens(id);
  if (t.edit) return 'edit';
  if (t.view) return 'view';
  return null;
}

export function canEdit(id: string): boolean {
  return !!getProjectTokens(id).edit;
}

/** The token to send on per-project API calls (prefer edit), or null if none held. */
export function tokenFor(id: string): string | null {
  const t = getProjectTokens(id);
  return t.edit ?? t.view ?? null;
}

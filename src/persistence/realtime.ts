// Realtime transport abstraction for collaborative editing.
//
// The rest of the app depends ONLY on the RealtimeProvider/RealtimeChannel interface here,
// never on a concrete backend. The default backend is Firebase Realtime Database; when RTDB is
// not configured (no NEXT_PUBLIC_FIREBASE_DATABASE_URL) the channel simply never opens and
// collaboration degrades to a no-op (the app stays fully usable, just not live).
//
// One channel is a single ephemeral broadcast LOG under channels/{projectId}/log. Each entry
// is an envelope (`RealtimeMessage`) carrying one logical topic:
//   • 'doc'      — full-document broadcast for last-write-wins sync
//   • 'playback' — opt-in transport (play/pause/seek) sync
//   • 'presence' — join/leave + the join-time state handshake
//   • 'sync'     — "enable sync playback" push: turning it on flips peers on (off never propagates)
//   • 'cursor'   — ephemeral live cursor position (seconds) + identity of a signed-in peer
//
// Late joiners do NOT replay history (that would re-apply stale docs): the listener is filtered
// to entries written after join, and convergence happens via the presence hello→doc handshake
// in hooks/useCollab.ts. Entries are removed shortly after delivery to bound growth.
//
// Auth: the browser fetches a per-project Firebase CUSTOM TOKEN from /api/realtime/token and
// signs in with it on a SEPARATE (secondary) Firebase app, so the primary Google session is
// untouched. The token's { pid, canEdit } claims are enforced by the RTDB security rules
// (view-only holders can read + publish presence but not edits).
//
// Echo prevention: every message carries `origin` (a stable per-tab id); receivers drop
// messages whose origin === their own ORIGIN.

import { initializeApp, deleteApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInWithCustomToken } from 'firebase/auth';
import {
  getDatabase,
  ref,
  push,
  set,
  remove,
  onChildAdded,
  onValue,
  onDisconnect,
  query,
  orderByChild,
  startAt,
  serverTimestamp,
  type Database,
  type DatabaseReference,
  type Unsubscribe,
} from 'firebase/database';
import { firebaseConfig, hasRealtimeConfig } from '../auth/firebase';
import { idToken } from '../auth/session';

export type RealtimeTopic = 'doc' | 'playback' | 'presence' | 'sync' | 'cursor';
export type RealtimeStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface RealtimeMessage<T = unknown> {
  topic: RealtimeTopic;
  /** Stable per-tab sender id; receivers drop their own messages (echo guard). */
  origin: string;
  /** Wall-clock ms at send (last-write-wins + playback latency compensation). */
  ts: number;
  payload: T;
}

export interface JoinOpts {
  projectId: string;
  origin: string;
  /** Per-project share token to authorize the realtime token request (null for the owner). */
  token: string | null;
  /** Whether this client may publish document edits (drives the requested capability). */
  canEdit: boolean;
}

export interface RealtimeChannel {
  /** Broadcast a message to all other subscribers of this project channel. */
  publish<T>(topic: RealtimeTopic, payload: T): void;
  /** Subscribe to inbound messages (already filtered to exclude this tab's own origin). */
  subscribe(handler: (msg: RealtimeMessage) => void): () => void;
  readonly status: RealtimeStatus;
  onStatus(cb: (s: RealtimeStatus) => void): () => void;
  close(): void;
}

export interface RealtimeProvider {
  join(opts: JoinOpts): RealtimeChannel;
}

/** Stable per-tab identity. A reload is a new participant (intentionally not persisted). */
export const ORIGIN: string =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

/** Ignore log entries older than (join time − grace) to skip history without missing fresh ones. */
const JOIN_GRACE_MS = 2_000;
/** How long a published entry lives before its author removes it (delivery is near-instant). */
const MESSAGE_TTL_MS = 8_000;

// Unique secondary-app names so concurrent / re-joined channels never collide.
let appSeq = 0;

// ── Firebase RTDB-backed provider ──────────────────────────────────────────────

class FirebaseChannel implements RealtimeChannel {
  status: RealtimeStatus = 'connecting';

  private app: FirebaseApp | null = null;
  private logRef: DatabaseReference | null = null;
  private unsubAdded: Unsubscribe | null = null;
  private unsubConnected: Unsubscribe | null = null;
  private readonly handlers = new Set<(m: RealtimeMessage) => void>();
  private readonly statusCbs = new Set<(s: RealtimeStatus) => void>();
  private closed = false;

  constructor(private readonly opts: JoinOpts) {
    void this.init();
  }

  private setStatus(s: RealtimeStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const cb of this.statusCbs) cb(s);
  }

  private async init(): Promise<void> {
    try {
      // 1. Get a per-project custom token (authorized by ID token and/or share token).
      const params = new URLSearchParams({ projectId: this.opts.projectId, cid: this.opts.origin });
      if (this.opts.token) params.set('token', this.opts.token);
      const headers: Record<string, string> = {};
      const idt = await idToken();
      if (idt) headers.Authorization = `Bearer ${idt}`;
      const res = await fetch(`${API_BASE}/api/realtime/token?${params.toString()}`, { headers });
      if (!res.ok) throw new Error(`realtime token request failed (${res.status})`);
      const { token } = (await res.json()) as { token: string };
      if (this.closed) return;

      // 2. Sign in on a SECONDARY app so the primary Google session is untouched.
      const app = initializeApp(firebaseConfig, `rt-${this.opts.projectId}-${++appSeq}`);
      this.app = app;
      await signInWithCustomToken(getAuth(app), token);
      if (this.closed) return;

      const db: Database = getDatabase(app);

      // 3. Compute a server-time threshold so we ignore pre-join history.
      const offset = await readServerTimeOffset(db);
      const joinAt = Date.now() + offset - JOIN_GRACE_MS;

      // 4. Subscribe to NEW log entries only.
      const logRef = ref(db, `channels/${this.opts.projectId}/log`);
      this.logRef = logRef;
      this.unsubAdded = onChildAdded(query(logRef, orderByChild('_s'), startAt(joinAt)), (snap) => {
        const data = snap.val() as (RealtimeMessage & { _s?: unknown }) | null;
        if (!data || data.origin === this.opts.origin) return; // echo guard
        const msg: RealtimeMessage = {
          topic: data.topic,
          origin: data.origin,
          ts: data.ts,
          payload: data.payload,
        };
        for (const h of this.handlers) h(msg);
      });

      // 5. Track connection state.
      this.unsubConnected = onValue(ref(db, '.info/connected'), (snap) => {
        if (this.closed) return;
        this.setStatus(snap.val() ? 'open' : 'connecting');
      });
    } catch (err) {
      if (this.closed) return;
      console.warn('[realtime] Firebase RTDB unavailable — collaboration disabled for this session.', err);
      this.setStatus('error');
    }
  }

  publish<T>(topic: RealtimeTopic, payload: T): void {
    if (this.closed || !this.logRef) return;
    const node = push(this.logRef);
    const env = { topic, origin: this.opts.origin, ts: Date.now(), payload, _s: serverTimestamp() };
    // Clean up if we drop offline before the TTL timer fires.
    try {
      void onDisconnect(node).remove();
    } catch {
      /* ignore */
    }
    set(node, env)
      .then(() => {
        setTimeout(() => void remove(node).catch(() => undefined), MESSAGE_TTL_MS);
      })
      .catch(() => {
        // Permission denied (view-only publishing a non-presence topic) or a transient error.
        // The full-doc model re-syncs on the next edit, so a dropped publish is harmless.
      });
  }

  subscribe(handler: (msg: RealtimeMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  onStatus(cb: (s: RealtimeStatus) => void): () => void {
    this.statusCbs.add(cb);
    cb(this.status);
    return () => this.statusCbs.delete(cb);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.unsubAdded?.();
      this.unsubConnected?.();
    } catch {
      /* ignore */
    }
    this.handlers.clear();
    this.statusCbs.clear();
    this.status = 'closed';
    const app = this.app;
    this.app = null;
    this.logRef = null;
    if (app) void deleteApp(app).catch(() => undefined);
  }
}

/** Read RTDB's server-time offset once (ms to add to Date.now() for server time). */
function readServerTimeOffset(db: Database): Promise<number> {
  return new Promise((resolve) => {
    onValue(
      ref(db, '.info/serverTimeOffset'),
      (snap) => resolve(Number(snap.val()) || 0),
      { onlyOnce: true },
    );
  });
}

class FirebaseRealtimeProvider implements RealtimeProvider {
  join(opts: JoinOpts): RealtimeChannel {
    return new FirebaseChannel(opts);
  }
}

// ── No-op provider (no backend configured) ─────────────────────────────────────

class NoopChannel implements RealtimeChannel {
  readonly status: RealtimeStatus = 'closed';
  publish(): void {}
  subscribe(): () => void {
    return () => {};
  }
  onStatus(cb: (s: RealtimeStatus) => void): () => void {
    cb('closed');
    return () => {};
  }
  close(): void {}
}

class NoopProvider implements RealtimeProvider {
  join(): RealtimeChannel {
    return new NoopChannel();
  }
}

// ── selection ──────────────────────────────────────────────────────────────────

let provider: RealtimeProvider | null = null;

/**
 * The single active realtime provider. Defaults to Firebase RTDB; falls back to a no-op when
 * realtime is force-disabled (NEXT_PUBLIC_REALTIME=off) or RTDB isn't configured, so the app
 * never attempts to connect.
 */
export function getRealtimeProvider(): RealtimeProvider {
  if (!provider) {
    provider =
      process.env.NEXT_PUBLIC_REALTIME === 'off' || !hasRealtimeConfig()
        ? new NoopProvider()
        : new FirebaseRealtimeProvider();
  }
  return provider;
}

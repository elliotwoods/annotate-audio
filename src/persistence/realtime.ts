// Realtime transport abstraction for collaborative editing.
//
// The rest of the app depends ONLY on the RealtimeProvider/RealtimeChannel interface here,
// never on a concrete backend. The default backend is Ably (managed pub/sub); when no Ably
// key is configured server-side the channel simply never opens and collaboration degrades
// to a no-op (the app stays fully usable, just not live).
//
// One channel carries three logical topics in a single envelope (`RealtimeMessage`):
//   • 'doc'      — full-document broadcast for last-write-wins sync
//   • 'playback' — opt-in transport (play/pause/seek) sync
//   • 'presence' — join/leave + the join-time state handshake
//
// Echo prevention: every message carries `origin` (a stable per-tab id); receivers drop
// messages whose origin === their own ORIGIN. Ably is also configured with echoMessages:false
// as a first line of defence.

import { getAdminKey } from '../auth/session';

export type RealtimeTopic = 'doc' | 'playback' | 'presence';
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
  /** Per-project share token to authorize the realtime token request (null for admin). */
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
// Single Ably event name; the real topic rides inside the envelope so all three logical
// topics share one subscription.
const EVENT = 'm';

// ── Ably-backed provider ──────────────────────────────────────────────────────

class AblyChannel implements RealtimeChannel {
  status: RealtimeStatus = 'connecting';

  // Ably types vary across major versions; keep the SDK loosely typed and expose our own
  // strict interface to the app.
  private client: any = null;
  private channel: any = null;
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
      const mod: any = await import('ably');
      if (this.closed) return;
      const Realtime = mod.Realtime ?? mod.default?.Realtime ?? mod.default;
      const adminKey = getAdminKey();

      const authParams: Record<string, string> = {
        projectId: this.opts.projectId,
        cid: this.opts.origin,
      };
      if (this.opts.token) authParams.token = this.opts.token;

      const client = new Realtime({
        authUrl: `${API_BASE}/api/realtime/token`,
        // GET keeps auth params in the query string, which both Vercel and the dev API
        // shim parse reliably (urlencoded POST bodies are not parsed by the dev shim).
        authMethod: 'GET',
        authParams,
        authHeaders: adminKey ? { Authorization: `Bearer ${adminKey}` } : undefined,
        echoMessages: false,
        // Don't hammer a missing/misconfigured backend forever.
        disconnectedRetryTimeout: 15000,
        suspendedRetryTimeout: 30000,
      });
      this.client = client;

      client.connection.on((change: any) => {
        if (this.closed) return;
        switch (change.current) {
          case 'connected':
            this.setStatus('open');
            break;
          case 'connecting':
          case 'disconnected':
          case 'suspended':
            this.setStatus('connecting');
            break;
          case 'closed':
            this.setStatus('closed');
            break;
          case 'failed':
            this.setStatus('error');
            break;
        }
      });

      const channel = client.channels.get(`project:${this.opts.projectId}`);
      this.channel = channel;
      await channel.subscribe(EVENT, (msg: any) => {
        const data = msg?.data as RealtimeMessage | undefined;
        if (!data || data.origin === this.opts.origin) return; // echo guard
        for (const h of this.handlers) h(data);
      });
    } catch (err) {
      if (this.closed) return;
      console.warn('[realtime] Ably unavailable — collaboration disabled for this session.', err);
      this.setStatus('error');
    }
  }

  publish<T>(topic: RealtimeTopic, payload: T): void {
    if (this.closed || !this.channel) return;
    const env: RealtimeMessage<T> = { topic, origin: this.opts.origin, ts: Date.now(), payload };
    try {
      this.channel.publish(EVENT, env);
    } catch {
      /* transient publish failure — full-doc model means the next edit re-syncs anyway */
    }
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
      this.channel?.unsubscribe();
      this.client?.close();
    } catch {
      /* ignore teardown errors */
    }
    this.handlers.clear();
    this.statusCbs.clear();
    this.status = 'closed';
  }
}

class AblyProvider implements RealtimeProvider {
  join(opts: JoinOpts): RealtimeChannel {
    return new AblyChannel(opts);
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
 * The single active realtime provider. Swap this one function to change backends.
 * Defaults to Ably; if the build explicitly disables realtime (NEXT_PUBLIC_REALTIME=off) a
 * no-op provider is used so the app never attempts to connect.
 */
export function getRealtimeProvider(): RealtimeProvider {
  if (!provider) {
    provider =
      process.env.NEXT_PUBLIC_REALTIME === 'off' ? new NoopProvider() : new AblyProvider();
  }
  return provider;
}

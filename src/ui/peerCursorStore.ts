// Live peer cursors: the timeline positions (in SECONDS) of other signed-in collaborators.
//
// Kept as a module-level store (not React state) so the frequent per-move updates don't churn
// re-renders — the PeerCursors overlay subscribes and repositions imperatively, exactly like
// pointerTime.ts / the Playhead. Entries are keyed by the sender's realtime `origin` and pruned
// on a TTL so a peer that drops without a clean 'bye' fades out.

export interface PeerCursor {
  origin: string;
  posSec: number;
  name: string;
  color: string;
  lastSeen: number; // epoch ms
}

const TTL_MS = 6_000;
const peers = new Map<string, PeerCursor>();
const subscribers = new Set<() => void>();

function notify(): void {
  for (const cb of subscribers) cb();
}

/** Insert/update a peer's cursor (stamps lastSeen). */
export function upsertPeerCursor(c: Omit<PeerCursor, 'lastSeen'>): void {
  peers.set(c.origin, { ...c, lastSeen: Date.now() });
  notify();
}

/** Remove a peer's cursor (peer left, or moved off the timeline). */
export function removePeerCursor(origin: string): void {
  if (peers.delete(origin)) notify();
}

/** Drop everything (e.g. leaving a project / closing the channel). */
export function clearPeerCursors(): void {
  if (peers.size) {
    peers.clear();
    notify();
  }
}

/** Currently-live cursors (prunes stale ones as a side effect). */
export function livePeerCursors(): PeerCursor[] {
  const now = Date.now();
  const out: PeerCursor[] = [];
  let pruned = false;
  for (const [origin, c] of peers) {
    if (now - c.lastSeen > TTL_MS) {
      peers.delete(origin);
      pruned = true;
    } else {
      out.push(c);
    }
  }
  if (pruned) queueMicrotask(notify);
  return out;
}

/** Subscribe to any change; returns an unsubscribe. */
export function subscribePeerCursors(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** Deterministic, readable hue from a stable id (uid/origin) → a distinct cursor color. */
export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 70% 60%)`;
}

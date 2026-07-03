// Collaborative-editing controller hook.
//
// Mounted once (in App). For a CLOUD project the current user has access to, it joins a
// realtime channel and:
//   • broadcasts local `core` edits (debounced, whole-document) and applies inbound ones
//     under last-write-wins, without echoing or polluting the local undo history;
//   • optionally syncs transport (play/pause/seek/stop) for ends that enable "sync playback".
//     Enabling it is a PUSH: turning sync on broadcasts a 'sync' message that flips every
//     connected peer on too, so one person can pull the room into a shared transport. Turning
//     it OFF is purely local — it never propagates, so a peer can drop out without dragging
//     the others off (and the enabler keeps driving anyone still synced).
//   • tracks lightweight presence for a "live · N" indicator.
//
// All view/playback/selection state stays local per user — only `core` is synchronised.
//
// Echo/loop guards:
//   • the provider drops messages from our own ORIGIN;
//   • `applyingRemoteDoc` makes the outbound store-subscriber skip the set that an inbound
//     apply triggers (applyRemoteCore builds a NEW core object, so an identity check alone
//     wouldn't catch it — a synchronous flag does);
//   • `suppressTransportUntil` swallows the transport events that applying a remote
//     play/pause/seek emits (play() resolves async, so a time window beats a bare flag).

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectCore } from '../model/types';
import { useStore, applyRemoteCoreNoHistory } from '../store/store';
import { transport, type TransportEvent } from '../audio/transport';
import {
  getRealtimeProvider,
  ORIGIN,
  type RealtimeChannel,
  type RealtimeMessage,
  type RealtimeStatus,
} from '../persistence/realtime';
import { canEdit, getProjectTokens, tokenFor, currentUser } from '../auth/session';
import { getPointerTime } from '../ui/pointerTime';
import {
  upsertPeerCursor,
  removePeerCursor,
  clearPeerCursors,
  colorForId,
} from '../ui/peerCursorStore';

const SYNC_PLAYBACK_KEY = 'aa.syncPlayback';
const DOC_DEBOUNCE_MS = 200;
const HEARTBEAT_MS = 10_000;
const PEER_TTL_MS = 25_000;
/** Window after applying a remote transport event during which we don't re-broadcast. */
const TRANSPORT_SUPPRESS_MS = 800;

export interface CollabState {
  /** True when this is a cloud project we can join a live session for. */
  enabled: boolean;
  status: RealtimeStatus;
  /** Number of OTHER participants currently present. */
  peerCount: number;
  syncPlayback: boolean;
  setSyncPlayback: (on: boolean) => void;
}

interface DocPayload {
  core: ProjectCore;
}
interface PlaybackPayload {
  kind: TransportEvent['kind'];
  positionSec: number;
}
interface PresencePayload {
  kind: 'hello' | 'state' | 'bye';
  canEdit: boolean;
  updatedAt: number;
}
interface SyncPayload {
  /** Only ever `true` — turning sync ON is the one transition that propagates. */
  on: boolean;
}
interface CursorPayload {
  /** Timeline position in seconds, or null when the pointer leaves the timeline. */
  posSec: number | null;
  name: string;
  color: string;
}

/** How often we sample + broadcast the local cursor (ms). Cheap, throttled. */
const CURSOR_BROADCAST_MS = 60;

// ── external "cloud status changed" signal ─────────────────────────────────────
// Saving a new project to the cloud (or signing in) grants access without changing the
// project id, so the hook's effect wouldn't otherwise re-run. Callers fire refreshCollab()
// to make any mounted useCollab re-evaluate and (re)join.
const refreshListeners = new Set<() => void>();
export function refreshCollab(): void {
  for (const l of refreshListeners) l();
}

function readSyncPref(): boolean {
  try {
    return localStorage.getItem(SYNC_PLAYBACK_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSyncPref(on: boolean): void {
  try {
    localStorage.setItem(SYNC_PLAYBACK_KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable — preference simply won't persist */
  }
}

export function useCollab(projectId: string): CollabState {
  const [status, setStatus] = useState<RealtimeStatus>('closed');
  const [peerCount, setPeerCount] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [syncPlayback, setSyncPlaybackState] = useState(readSyncPref);
  const [refreshTick, setRefreshTick] = useState(0);

  // Read by channel listeners without forcing a re-subscribe when it changes.
  const syncRef = useRef(syncPlayback);
  syncRef.current = syncPlayback;

  // The live channel, so the (effect-external) toggle can broadcast a sync-on push.
  const channelRef = useRef<RealtimeChannel | null>(null);

  const setSyncPlayback = useCallback((on: boolean) => {
    setSyncPlaybackState(on);
    writeSyncPref(on);
    // Turning sync ON pushes every connected peer to enable it too; turning OFF is local-only
    // (a silent opt-out) so a peer can drop out without dragging the others off with them.
    if (on) channelRef.current?.publish('sync', { on: true } satisfies SyncPayload);
  }, []);

  // Re-run the join effect when cloud access changes (post-save / post-login).
  useEffect(() => {
    const l = () => setRefreshTick((t) => t + 1);
    refreshListeners.add(l);
    return () => {
      refreshListeners.delete(l);
    };
  }, []);

  useEffect(() => {
    const tokens = projectId ? getProjectTokens(projectId) : {};
    const isCloud = !!(tokens.view || tokens.edit);
    if (!projectId || !isCloud) {
      setEnabled(false);
      setStatus('closed');
      setPeerCount(0);
      return;
    }
    setEnabled(true);

    const channel: RealtimeChannel = getRealtimeProvider().join({
      projectId,
      origin: ORIGIN,
      token: tokenFor(projectId),
      canEdit: canEdit(projectId),
    });
    channelRef.current = channel;

    // ── presence ────────────────────────────────────────────────────────────
    const peers = new Map<string, number>(); // origin → lastSeen ms
    const refreshPeerCount = () => {
      const now = Date.now();
      for (const [origin, seen] of peers) if (now - seen > PEER_TTL_MS) peers.delete(origin);
      setPeerCount(peers.size);
    };
    const announce = (kind: PresencePayload['kind']) =>
      channel.publish('presence', {
        kind,
        canEdit: canEdit(projectId),
        updatedAt: useStore.getState().core.updatedAt,
      } satisfies PresencePayload);

    // ── outbound: local core edits ────────────────────────────────────────────
    let prevCore = useStore.getState().core;
    let applyingRemoteDoc = false;
    let docTimer: ReturnType<typeof setTimeout> | null = null;
    const publishDocDebounced = () => {
      if (docTimer) clearTimeout(docTimer);
      docTimer = setTimeout(() => {
        docTimer = null;
        channel.publish('doc', { core: useStore.getState().core } satisfies DocPayload);
      }, DOC_DEBOUNCE_MS);
    };
    const unsubStore = useStore.subscribe((state) => {
      if (state.core === prevCore) return;
      prevCore = state.core;
      if (applyingRemoteDoc) return; // this change is the result of applying a remote doc
      if (!canEdit(projectId)) return; // view-only never broadcasts (server also blocks it)
      publishDocDebounced();
    });

    // ── outbound: transport sync ──────────────────────────────────────────────
    let suppressTransportUntil = 0;
    const unsubTransport = transport.onTransport((e) => {
      if (!syncRef.current) return;
      if (Date.now() < suppressTransportUntil) return; // applying a remote transport event
      channel.publish('playback', { kind: e.kind, positionSec: e.pos } satisfies PlaybackPayload);
    });

    // ── inbound ───────────────────────────────────────────────────────────────
    const applyRemoteDoc = (core: ProjectCore) => {
      if (core.updatedAt < useStore.getState().core.updatedAt) return; // last-write-wins
      applyingRemoteDoc = true;
      try {
        applyRemoteCoreNoHistory(core);
      } finally {
        applyingRemoteDoc = false;
      }
      prevCore = useStore.getState().core; // realign the outbound detector with the applied core
    };

    const applyRemotePlayback = (p: PlaybackPayload, sentTs: number) => {
      if (!syncRef.current) return; // only follow if WE also opted in
      suppressTransportUntil = Date.now() + TRANSPORT_SUPPRESS_MS;
      const latency = Math.max(0, (Date.now() - sentTs) / 1000);
      switch (p.kind) {
        case 'play':
          transport.seek(p.positionSec + latency); // originator kept playing in transit
          void transport.play();
          break;
        case 'pause':
          transport.seek(p.positionSec);
          transport.pause();
          break;
        case 'seek':
          transport.seek(p.positionSec);
          break;
        case 'stop':
          transport.stop();
          break;
      }
    };

    const unsubChannel = channel.subscribe((msg: RealtimeMessage) => {
      switch (msg.topic) {
        case 'doc': {
          const core = (msg.payload as DocPayload)?.core;
          if (core) applyRemoteDoc(core);
          break;
        }
        case 'playback':
          applyRemotePlayback(msg.payload as PlaybackPayload, msg.ts);
          break;
        case 'sync': {
          // A peer turned sync on → follow them on. We update state/persist directly rather
          // than via setSyncPlayback so we DON'T re-broadcast (avoids an enable storm), and we
          // never auto-off, so a local opt-out stays opted out until someone enables again.
          if ((msg.payload as SyncPayload)?.on) {
            setSyncPlaybackState(true);
            writeSyncPref(true);
          }
          break;
        }
        case 'cursor': {
          const c = msg.payload as CursorPayload;
          if (c.posSec == null) removePeerCursor(msg.origin);
          else upsertPeerCursor({ origin: msg.origin, posSec: c.posSec, name: c.name, color: c.color });
          break;
        }
        case 'presence': {
          const p = msg.payload as PresencePayload;
          if (p.kind === 'bye') {
            peers.delete(msg.origin);
            removePeerCursor(msg.origin);
          } else peers.set(msg.origin, Date.now());
          refreshPeerCount();
          // A newcomer announced itself → reply with our presence, and (if we can edit) push
          // our current document so they converge past their stale snapshot baseline. Any
          // editor may answer; last-write-wins dedupes multiple replies.
          if (p.kind === 'hello') {
            announce('state');
            if (canEdit(projectId)) {
              channel.publish('doc', { core: useStore.getState().core } satisfies DocPayload);
            }
          }
          break;
        }
      }
    });

    // ── status + heartbeat ────────────────────────────────────────────────────
    const unsubStatus = channel.onStatus((s) => {
      setStatus(s);
      if (s === 'open') announce('hello');
    });
    const heartbeat = setInterval(() => {
      if (channel.status === 'open') announce('state');
      refreshPeerCount();
    }, HEARTBEAT_MS);

    // ── outbound: live cursor (signed-in users only) ──────────────────────────
    // Sample the hovered timeline time and broadcast it (throttled). Positions are in
    // SECONDS (canonical) so each peer re-projects through their own zoom/scroll.
    let lastCursor: number | null | undefined = undefined;
    const cursorTimer = setInterval(() => {
      if (channel.status !== 'open') return;
      const u = currentUser();
      if (!u) return; // only signed-in users share a cursor
      const posSec = getPointerTime();
      if (posSec === lastCursor) return; // unchanged since last tick
      lastCursor = posSec;
      channel.publish('cursor', {
        posSec,
        name: u.displayName || u.email || 'Someone',
        color: colorForId(u.uid),
      } satisfies CursorPayload);
    }, CURSOR_BROADCAST_MS);

    return () => {
      if (docTimer) clearTimeout(docTimer);
      clearInterval(heartbeat);
      clearInterval(cursorTimer);
      clearPeerCursors();
      try {
        announce('bye');
      } catch {
        /* channel may already be closing */
      }
      unsubStore();
      unsubTransport();
      unsubChannel();
      unsubStatus();
      channel.close();
      if (channelRef.current === channel) channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, refreshTick]);

  return { enabled, status, peerCount, syncPlayback, setSyncPlayback };
}

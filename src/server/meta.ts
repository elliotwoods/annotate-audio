// Project "meta" record — the per-project index object stored at
// projects/{id}/meta.json. Snapshots themselves are immutable; this small record is the
// only thing rewritten on each save (to advance the `latest` pointer + timestamps).

import { getJSON, putJSON } from './storage';

export interface ProjectMeta {
  id: string;
  name: string;
  /** Firebase uid of the user who created (owns) this set. The library lists only your own
   *  sets, and the owner has full view/edit/delete without needing a share token. */
  ownerUid: string;
  /** Firebase uids granted persistent edit access by accepting an edit invite (opening an
   *  edit link while signed in). Absent on legacy metas ⇒ treat as []. */
  editors?: string[];
  /** Content hash of the audio referenced by the latest snapshot (or null). */
  audioHash: string | null;
  /** Per-project capability secrets shared via private links. The edit token acts as an
   *  INVITE: an anonymous holder gets view-only; a signed-in holder becomes an editor. */
  viewToken: string;
  editToken: string;
  /** Key of the most recent snapshot object, e.g. "1718000000000-ab12cd". */
  latest: string | null;
  createdAt: number;
  updatedAt: number;
}

export function metaKey(id: string): string {
  return `projects/${id}/meta.json`;
}

export function readMeta(id: string): Promise<ProjectMeta | null> {
  return getJSON<ProjectMeta>(metaKey(id));
}

export function writeMeta(meta: ProjectMeta): Promise<void> {
  return putJSON(metaKey(meta.id), meta);
}

// ── snapshot keys ────────────────────────────────────────────────────────────
// Snapshots are immutable objects at projects/{id}/snapshots/{snapId}.json where
// snapId = "{epochMs}-{rand}". The epoch prefix makes lexical order == chronological.

export function snapshotPrefix(id: string): string {
  return `projects/${id}/snapshots/`;
}

export function snapshotKey(id: string, snapId: string): string {
  return `${snapshotPrefix(id)}${snapId}.json`;
}

/** Extract the snapId from a full snapshot object key (inverse of snapshotKey). */
export function snapIdFromKey(key: string): string {
  return key.substring(key.lastIndexOf('/') + 1).replace(/\.json$/, '');
}

/** Epoch-ms timestamp encoded in a snapId, or 0 if unparseable. */
export function snapTimestamp(snapId: string): number {
  const n = Number(snapId.split('-')[0]);
  return Number.isFinite(n) ? n : 0;
}

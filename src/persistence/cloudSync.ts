// Cloud open/save orchestration: ties the Zustand store, local audio cache, and the cloud
// API together so the UI layer stays thin. Save creates a new immutable snapshot (never
// overwrites); open loads a snapshot and rehydrates audio (local cache → cloud fallback).

import { useStore } from '../store/store';
import { clearAudioSession, rehydrateAudio } from '../audio/audioFile';
import { getAudioBlob, saveAudioBlob, saveProject as saveProjectLocal } from './db';
import {
  CloudError,
  createCloudProject,
  ensureAudioUploaded,
  fetchAudioBlob,
  loadCloudProject,
  saveSnapshot,
  type CloudMeta,
} from './cloud';
import { getProjectTokens, isVerified } from '../auth/session';

export interface SaveResult {
  id: string;
  snapshotId: string;
  /** True if this call created the cloud project (first save), false for a later snapshot. */
  created: boolean;
}

/**
 * Push the current project to the cloud as a NEW snapshot. Uploads the referenced audio
 * blob first (deduped by hash). Creates the cloud project on first save (verified users),
 * otherwise appends a snapshot to the existing set (edit access).
 */
export async function saveCurrentToCloud(): Promise<SaveResult> {
  const project = useStore.getState().exportProject();
  const id = project.id;

  // Upload audio before the snapshot so a freshly-shared link can always play it.
  if (project.audio) {
    const blob = await getAudioBlob(project.audio.hash);
    if (blob) await ensureAudioUploaded(id, project.audio.hash, blob);
  }

  const tokens = getProjectTokens(id);

  // Already a cloud set we can edit → just append a snapshot.
  if (tokens.edit) {
    const { snapshotId } = await saveSnapshot(id, project);
    return { id, snapshotId, created: false };
  }

  // Verified user: create the set (or append if it already exists in the cloud).
  if (isVerified()) {
    try {
      const r = await createCloudProject(project);
      return { id: r.id, snapshotId: r.latest, created: true };
    } catch (err) {
      if (err instanceof CloudError && err.status === 409) {
        const { snapshotId } = await saveSnapshot(id, project);
        return { id, snapshotId, created: false };
      }
      throw err;
    }
  }

  throw new CloudError('You do not have edit access to save this set.', 403);
}

export interface OpenResult {
  meta: CloudMeta;
  snapshot: string;
  /** True if audio is ready (no audio referenced, or it was rehydrated). */
  audioReady: boolean;
}

/**
 * Open a cloud set into the editor. Loads the requested snapshot (default: latest), then
 * rehydrates audio from the local cache, falling back to a cloud download (cached locally
 * by hash for next time). Also mirrors the project into IndexedDB so it appears locally.
 */
export async function openCloudProject(
  id: string,
  opts?: { snapshot?: string },
): Promise<OpenResult> {
  const { meta, snapshot, project } = await loadCloudProject(id, opts);

  clearAudioSession();
  useStore.getState().loadProject(project);
  // Keep a local copy so the set shows up in the offline library / autosaves cleanly.
  try {
    await saveProjectLocal(project);
  } catch {
    /* local mirror is best-effort */
  }

  if (!project.audio) return { meta, snapshot, audioReady: true };

  let ready = await rehydrateAudio(project.audio);
  if (!ready) {
    const blob = await fetchAudioBlob(id, project.audio.hash);
    if (blob) {
      try {
        await saveAudioBlob(project.audio.hash, blob);
      } catch {
        /* quota — still try to decode below from the in-memory blob via re-cache */
      }
      ready = await rehydrateAudio(project.audio);
    }
  }
  return { meta, snapshot, audioReady: ready };
}

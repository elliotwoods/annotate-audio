// IndexedDB persistence (spec §13.2) via the `idb` promise wrapper.
//
// Two object stores in the `cue-timeline` database:
//   - `projects`: keyed by `project.id`, value = full Project JSON.
//   - `audio`:    keyed by `audio.hash`, value = the original File/Blob, so reopening
//                 a project re-decodes locally without re-importing the file.
//
// The openDB() promise is memoized so the whole app shares a single connection.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Project } from '../model/types';

const DB_NAME = 'cue-timeline';
const DB_VERSION = 1;
const PROJECTS_STORE = 'projects';
const AUDIO_STORE = 'audio';

interface CueTimelineDB extends DBSchema {
  projects: {
    key: string; // project.id
    value: Project;
  };
  audio: {
    key: string; // audio.hash
    value: Blob;
  };
}

let dbPromise: Promise<IDBPDatabase<CueTimelineDB>> | null = null;

/** Open (and memoize) the database connection, creating object stores on first use. */
function getDB(): Promise<IDBPDatabase<CueTimelineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CueTimelineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
          db.createObjectStore(PROJECTS_STORE);
        }
        if (!db.objectStoreNames.contains(AUDIO_STORE)) {
          db.createObjectStore(AUDIO_STORE);
        }
      },
    });
  }
  return dbPromise;
}

// ── projects ────────────────────────────────────────────────────────────────

/** All stored projects, newest first by `updatedAt`. */
export async function listProjects(): Promise<Project[]> {
  const db = await getDB();
  const all = await db.getAll(PROJECTS_STORE);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await getDB();
  return db.get(PROJECTS_STORE, id);
}

export async function saveProject(p: Project): Promise<void> {
  const db = await getDB();
  await db.put(PROJECTS_STORE, p, p.id);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(PROJECTS_STORE, id);
}

// ── audio blobs ───────────────────────────────────────────────────────────────

export async function getAudioBlob(hash: string): Promise<Blob | undefined> {
  const db = await getDB();
  return db.get(AUDIO_STORE, hash);
}

export async function saveAudioBlob(hash: string, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put(AUDIO_STORE, blob, hash);
}

export async function deleteAudioBlob(hash: string): Promise<void> {
  const db = await getDB();
  await db.delete(AUDIO_STORE, hash);
}

export async function listAudioHashes(): Promise<string[]> {
  const db = await getDB();
  return db.getAllKeys(AUDIO_STORE);
}

export async function clearAllAudio(): Promise<void> {
  const db = await getDB();
  await db.clear(AUDIO_STORE);
}

// ── storage estimate ───────────────────────────────────────────────────────────

/**
 * Best-effort storage usage/quota via the StorageManager API. Returns null when the
 * API is unavailable or returns no numeric figures.
 */
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  const storage = navigator.storage;
  if (!storage || typeof storage.estimate !== 'function') return null;
  try {
    const { usage, quota } = await storage.estimate();
    if (typeof usage !== 'number' || typeof quota !== 'number') return null;
    return { usage, quota };
  } catch {
    return null;
  }
}

// Cloud API client (talks to the Vercel /api functions).
//
// Mirrors the local persistence layer (db.ts / json.ts) but over HTTP. Verified users send
// their admin key as a bearer token; link holders send a per-project `token` query param.
// Audio blobs are uploaded/downloaded DIRECTLY to/from R2 via short presigned URLs; only
// small project JSON travels through the functions.

import type { Project } from '../model/types';
import { validateProject } from './json';
import {
  idToken,
  isVerified,
  getProjectTokens,
  rememberTokens,
  tokenFor,
  type ProjectTokens,
} from '../auth/session';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

export interface CloudProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  createdAt: number;
}

export interface CloudMeta {
  id: string;
  name: string;
  audioHash: string | null;
  latest: string | null;
  createdAt: number;
  updatedAt: number;
  viewToken?: string;
  editToken?: string;
}

export interface SnapshotInfo {
  id: string;
  createdAt: number;
}

export interface CreateResult {
  id: string;
  viewToken: string;
  editToken: string;
  latest: string;
}

// ── low-level fetch ──────────────────────────────────────────────────────────

/** Build request headers carrying the signed-in user's Firebase ID token (if any). */
async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await idToken();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

/** Append `?token=` (the per-project share secret) when we hold one. Harmless alongside an
 *  owner's ID token — the server prefers ownership and falls back to the token. */
function withToken(path: string, id: string): string {
  const token = tokenFor(id);
  if (!token) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}token=${encodeURIComponent(token)}`;
}

async function apiJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, init);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON (shouldn't happen) */
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `Request failed (${res.status}).`;
    throw new CloudError(msg, res.status);
  }
  return data as T;
}

export class CloudError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CloudError';
    this.status = status;
  }
}

// ── projects ───────────────────────────────────────────────────────────────────

/** Signed-in user's library: the cloud sets you own. */
export async function listCloudProjects(): Promise<CloudProjectSummary[]> {
  const r = await apiJSON<{ projects: CloudProjectSummary[] }>('/api/projects', {
    headers: await authHeaders(),
  });
  return r.projects;
}

/** Create a new cloud set (signed-in users only). Persists the returned tokens. */
export async function createCloudProject(project: Project): Promise<CreateResult> {
  const result = await apiJSON<CreateResult>('/api/projects', {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(project),
  });
  rememberTokens(result.id, { view: result.viewToken, edit: result.editToken });
  return result;
}

/** Load a set (latest snapshot, or a specific one). Returns a normalized Project. */
export async function loadCloudProject(
  id: string,
  opts?: { snapshot?: string },
): Promise<{ meta: CloudMeta; snapshot: string; project: Project }> {
  let path = `/api/projects/${encodeURIComponent(id)}`;
  if (opts?.snapshot) path += `?snapshot=${encodeURIComponent(opts.snapshot)}`;
  const data = await apiJSON<{ meta: CloudMeta; snapshot: string; project: unknown }>(
    withToken(path, id),
    { headers: await authHeaders() },
  );
  // Edit links/admin get tokens echoed back — persist them so the user keeps access.
  if (data.meta.viewToken || data.meta.editToken) {
    rememberTokens(id, { view: data.meta.viewToken, edit: data.meta.editToken });
  }
  return { meta: data.meta, snapshot: data.snapshot, project: validateProject(data.project) };
}

/**
 * Recover an existing cloud set's tokens for a verified owner who lacks them locally
 * (e.g. opened the set from the offline library, or cleared storage). The GET endpoint
 * echoes view/edit tokens back to admin/edit callers; persist them. Best-effort — returns
 * whatever tokens we now hold for the project.
 */
export async function recoverProjectTokens(id: string): Promise<ProjectTokens> {
  try {
    const data = await apiJSON<{ meta: CloudMeta }>(
      withToken(`/api/projects/${encodeURIComponent(id)}`, id),
      { headers: await authHeaders() },
    );
    if (data.meta.viewToken || data.meta.editToken) {
      rememberTokens(id, { view: data.meta.viewToken, edit: data.meta.editToken });
    }
  } catch {
    /* leave tokens as-is; the next open retries */
  }
  return getProjectTokens(id);
}

export async function listSnapshots(
  id: string,
): Promise<{ snapshots: SnapshotInfo[]; latest: string | null }> {
  return apiJSON(withToken(`/api/projects/${encodeURIComponent(id)}/snapshots`, id), {
    headers: await authHeaders(),
  });
}

/** Save a NEW immutable snapshot (edit access). Never overwrites prior saves. */
export async function saveSnapshot(
  id: string,
  project: Project,
): Promise<{ snapshotId: string; createdAt: number }> {
  return apiJSON(withToken(`/api/projects/${encodeURIComponent(id)}/snapshots`, id), {
    method: 'POST',
    headers: await authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(project),
  });
}

// ── audio (direct-to-R2 via presigned URLs) ───────────────────────────────────

/** Ensure the audio blob for `hash` exists in the cloud, uploading it if missing. */
export async function ensureAudioUploaded(
  projectId: string,
  hash: string,
  blob: Blob,
): Promise<void> {
  const res = await apiJSON<{ exists: boolean; url?: string }>(
    withToken('/api/audio/upload-url', projectId),
    {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ projectId, hash, contentType: blob.type || 'application/octet-stream' }),
    },
  );
  if (res.exists || !res.url) return;
  let put: Response;
  try {
    put = await fetch(res.url, {
      method: 'PUT',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
  } catch (err) {
    // A rejected fetch (vs. a non-2xx response) to the R2 host is almost always the browser
    // blocking a cross-origin request because the bucket has no CORS rule for this site's
    // origin — run `node scripts/set-r2-cors.mjs` to add one.
    throw new CloudError(
      `Could not reach audio storage to upload the track. This usually means the R2 bucket is ` +
        `missing a CORS rule for ${window.location.origin} (browser blocked the upload). ` +
        `Underlying error: ${(err as Error).message}`,
      0,
    );
  }
  if (!put.ok) throw new CloudError(`Audio upload failed (${put.status}).`, put.status);
}

/** Download an audio blob from the cloud (view access). Returns null if not present. */
export async function fetchAudioBlob(projectId: string, hash: string): Promise<Blob | null> {
  let path = `/api/audio/${encodeURIComponent(hash)}`;
  // The download route authorizes against the referencing project.
  const sep = '?';
  path += `${sep}p=${encodeURIComponent(projectId)}`;
  try {
    const { url } = await apiJSON<{ url: string }>(withToken(path, projectId), {
      headers: await authHeaders(),
    });
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      // Same cross-origin story as the upload path: a rejected fetch to the R2 host means the
      // bucket is missing a CORS rule for this site's origin.
      throw new CloudError(
        `Could not reach audio storage to download the track. This usually means the R2 bucket ` +
          `is missing a CORS rule for ${window.location.origin}. ` +
          `Underlying error: ${(err as Error).message}`,
        0,
      );
    }
    if (!res.ok) return null;
    return await res.blob();
  } catch (err) {
    if (err instanceof CloudError && err.status === 404) return null;
    throw err;
  }
}

/** Whether the user currently holds any access to this project (admin or stored token). */
export function hasCloudAccess(id: string): boolean {
  if (isVerified()) return true;
  const t = getProjectTokens(id);
  return !!(t.view || t.edit);
}

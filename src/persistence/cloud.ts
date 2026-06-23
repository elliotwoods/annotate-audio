// Cloud API client (talks to the Vercel /api functions).
//
// Mirrors the local persistence layer (db.ts / json.ts) but over HTTP. Verified users send
// their admin key as a bearer token; link holders send a per-project `token` query param.
// Audio blobs are uploaded/downloaded DIRECTLY to/from R2 via short presigned URLs; only
// small project JSON travels through the functions.

import type { Project } from '../model/types';
import { validateProject } from './json';
import { getAdminKey, getProjectTokens, rememberTokens, tokenFor } from '../auth/session';

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

function adminHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = getAdminKey();
  return { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extra };
}

/** Append `?token=` for the given project when the caller isn't admin. */
function withToken(path: string, id: string): string {
  if (getAdminKey()) return path;
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

// ── auth ─────────────────────────────────────────────────────────────────────

/** Verify an admin key against the server (login). Returns true if accepted. */
export async function verifyKey(key: string): Promise<boolean> {
  try {
    await apiJSON('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
    return true;
  } catch (err) {
    if (err instanceof CloudError && err.status === 401) return false;
    throw err;
  }
}

// ── projects ───────────────────────────────────────────────────────────────────

/** Verified-user library: all cloud sets. */
export function listCloudProjects(): Promise<CloudProjectSummary[]> {
  return apiJSON<{ projects: CloudProjectSummary[] }>('/api/projects', {
    headers: adminHeaders(),
  }).then((r) => r.projects);
}

/** Create a new cloud set (verified users only). Persists the returned tokens. */
export async function createCloudProject(project: Project): Promise<CreateResult> {
  const result = await apiJSON<CreateResult>('/api/projects', {
    method: 'POST',
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
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
    { headers: adminHeaders() },
  );
  // Edit links/admin get tokens echoed back — persist them so the user keeps access.
  if (data.meta.viewToken || data.meta.editToken) {
    rememberTokens(id, { view: data.meta.viewToken, edit: data.meta.editToken });
  }
  return { meta: data.meta, snapshot: data.snapshot, project: validateProject(data.project) };
}

export function listSnapshots(id: string): Promise<{ snapshots: SnapshotInfo[]; latest: string | null }> {
  return apiJSON(withToken(`/api/projects/${encodeURIComponent(id)}/snapshots`, id), {
    headers: adminHeaders(),
  });
}

/** Save a NEW immutable snapshot (edit access). Never overwrites prior saves. */
export function saveSnapshot(
  id: string,
  project: Project,
): Promise<{ snapshotId: string; createdAt: number }> {
  return apiJSON(withToken(`/api/projects/${encodeURIComponent(id)}/snapshots`, id), {
    method: 'POST',
    headers: adminHeaders({ 'Content-Type': 'application/json' }),
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
      headers: adminHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ projectId, hash, contentType: blob.type || 'application/octet-stream' }),
    },
  );
  if (res.exists || !res.url) return;
  const put = await fetch(res.url, {
    method: 'PUT',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
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
      headers: adminHeaders(),
    });
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch (err) {
    if (err instanceof CloudError && err.status === 404) return null;
    throw err;
  }
}

/** Whether the user currently holds any access to this project (admin or stored token). */
export function hasCloudAccess(id: string): boolean {
  if (getAdminKey()) return true;
  const t = getProjectTokens(id);
  return !!(t.view || t.edit);
}

// Cloud Storage access for the Next.js API route handlers (server-only).
//
// Drop-in replacement for the former Cloudflare R2 layer: same object-store interface, same
// key layout, so the route handlers and meta.ts are unchanged apart from the import path.
// The bucket is PRIVATE — browsers never get raw credentials; large blobs (audio) move via
// short-lived V4 signed PUT/GET URLs, small JSON (projects/meta) is read/written here
// in-process through the Admin SDK (which bypasses Storage security rules).
//
// Object layout (see src/server/meta.ts and the route handlers):
//   projects/{id}/meta.json
//   projects/{id}/snapshots/{ts}-{rand}.json
//   audio/{sha256}

import { adminBucket } from './firebaseAdmin';

/** Signed-URL lifetime (ms). Short — clients use them immediately. */
const PRESIGN_TTL_MS = 600_000;

// ── JSON objects (read/write in-process) ─────────────────────────────────────

/** Read + parse a JSON object. Returns null if the key does not exist. */
export async function getJSON<T>(key: string): Promise<T | null> {
  try {
    const [buf] = await adminBucket().file(key).download();
    return JSON.parse(buf.toString('utf8')) as T;
  } catch (err: unknown) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Write a value as pretty JSON. */
export async function putJSON(key: string, value: unknown): Promise<void> {
  await adminBucket()
    .file(key)
    .save(JSON.stringify(value, null, 2), {
      contentType: 'application/json',
      resumable: false,
    });
}

// ── existence + listing ──────────────────────────────────────────────────────

/** True if an object exists at `key`. */
export async function objectExists(key: string): Promise<boolean> {
  const [exists] = await adminBucket().file(key).exists();
  return exists;
}

/** List object keys under a prefix (the SDK paginates through to completion). */
export async function listKeys(prefix: string): Promise<string[]> {
  const [files] = await adminBucket().getFiles({ prefix });
  return files.map((f) => f.name);
}

// ── signed URLs (browser ⇄ Cloud Storage direct, for audio blobs) ─────────────
// NOTE: on App Hosting / Cloud Run the runtime service account has no private key, so signing
// uses the IAM `signBlob` API. That account needs the "Service Account Token Creator" role on
// itself and the IAM Service Account Credentials API enabled, or these calls fail at runtime.

export async function presignPut(key: string, contentType: string): Promise<string> {
  const [url] = await adminBucket()
    .file(key)
    .getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + PRESIGN_TTL_MS,
      contentType,
    });
  return url;
}

export async function presignGet(key: string): Promise<string> {
  const [url] = await adminBucket()
    .file(key)
    .getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + PRESIGN_TTL_MS,
    });
  return url;
}

/** Cloud Storage / google-cloud errors expose a numeric `code`; 404 == missing object. */
function isNotFound(err: unknown): boolean {
  const e = err as { code?: number | string };
  return e?.code === 404 || e?.code === '404';
}

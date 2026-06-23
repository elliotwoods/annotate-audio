// Cloudflare R2 access (S3-compatible) for the Next.js API route handlers (server-only).
//
// R2 is reached through the AWS S3 SDK pointed at the account's R2 endpoint. The bucket
// is PRIVATE — browsers never get raw credentials; large blobs (audio) move via short
// presigned PUT/GET URLs, small JSON (projects/meta) is read/written here in-process.
//
// Object layout (see src/server/meta.ts and the route handlers):
//   projects/{id}/meta.json
//   projects/{id}/snapshots/{ts}-{rand}.json
//   audio/{sha256}

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT } =
  process.env;

export const BUCKET = R2_BUCKET ?? '';

/** Presigned URL lifetime (seconds). Short — clients use them immediately. */
const PRESIGN_TTL = 600;

let client: S3Client | null = null;

/** Lazily build (and memoize) the S3 client for R2. Throws if env is missing. */
export function r2(): S3Client {
  if (client) return client;
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !BUCKET) {
    throw new Error('R2 is not configured (missing R2_* environment variables).');
  }
  const endpoint = R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  client = new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  return client;
}

// ── JSON objects (read/write in-process) ─────────────────────────────────────

/** Read + parse a JSON object. Returns null if the key does not exist. */
export async function getJSON<T>(key: string): Promise<T | null> {
  try {
    const out = await r2().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const text = await out.Body!.transformToString();
    return JSON.parse(text) as T;
  } catch (err: unknown) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Write a value as pretty JSON. */
export async function putJSON(key: string, value: unknown): Promise<void> {
  await r2().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: 'application/json',
    }),
  );
}

// ── existence + listing ──────────────────────────────────────────────────────

/** True if an object exists at `key`. */
export async function objectExists(key: string): Promise<boolean> {
  try {
    await r2().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (err: unknown) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/** List object keys under a prefix (paginated through to completion). */
export async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const out = await r2().send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    for (const obj of out.Contents ?? []) if (obj.Key) keys.push(obj.Key);
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

// ── presigned URLs (browser ⇄ R2 direct, for audio blobs) ─────────────────────

export function presignPut(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    r2(),
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: PRESIGN_TTL },
  );
}

export function presignGet(key: string): Promise<string> {
  return getSignedUrl(r2(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: PRESIGN_TTL,
  });
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}

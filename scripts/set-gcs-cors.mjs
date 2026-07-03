// Set the Cloud Storage bucket's CORS policy so the browser can upload/download audio blobs
// DIRECTLY to/from the bucket via V4 signed URLs. Without this, the cross-origin PUT/GET the
// browser makes to `storage.googleapis.com` is blocked and the app shows an audio-transfer
// error (project/snapshot JSON still saves, because that goes through the API server-side —
// only the direct-to-bucket audio transfer needs CORS).
//
// Idempotent: run it whenever the set of allowed origins changes.
//
//   GCS_CORS_ORIGINS="http://localhost:3000,https://your-app.web.app" node scripts/set-gcs-cors.mjs
//
// Credentials: uses Application Default Credentials (run `gcloud auth application-default
// login`), or GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_SERVICE_ACCOUNT. STORAGE_BUCKET (or
// NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) must name the bucket. The credential needs
// storage.buckets.update on it (e.g. roles/storage.admin).

import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

// ── load .env.local (optional) ─────────────────────────────────────────────────
const env = {};
try {
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
  }
} catch {
  /* no .env.local — rely on the real environment */
}

const pick = (k) => process.env[k] || env[k];

const BUCKET = pick('STORAGE_BUCKET') || pick('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET');
const saJson = pick('FIREBASE_SERVICE_ACCOUNT');

const origins = (pick('GCS_CORS_ORIGINS') || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!BUCKET) {
  console.error('❌ STORAGE_BUCKET (or NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) is not set.');
  process.exit(1);
}

console.log('Bucket :', BUCKET);
console.log('Origins:', origins.join(', '));
console.log('');

initializeApp({
  ...(saJson ? { credential: cert(JSON.parse(saJson)) } : {}),
  storageBucket: BUCKET,
});

const bucket = getStorage().bucket(BUCKET);
const cors = [
  {
    origin: origins,
    // GET = download audio; PUT = signed upload; HEAD = existence/range checks.
    method: ['GET', 'PUT', 'HEAD'],
    responseHeader: ['*'],
    maxAgeSeconds: 3600,
  },
];

try {
  await bucket.setCorsConfiguration(cors);
  console.log('✅ CORS policy applied. Now set to:');
  const [meta] = await bucket.getMetadata();
  console.log(JSON.stringify(meta.cors ?? [], null, 2));
} catch (err) {
  console.error(`❌ Failed to set CORS: ${err.message}`);
  process.exit(1);
}

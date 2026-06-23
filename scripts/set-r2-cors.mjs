// Set the R2 bucket's CORS policy so the browser can upload/download audio blobs DIRECTLY
// to/from R2 via presigned URLs. Without this, the cross-origin PUT/GET the browser makes to
// `<account>.r2.cloudflarestorage.com` is blocked by the same-origin policy and the app shows
// "Cloud save failed" (project/snapshot JSON still saves, because that goes through the API
// server-side — only the direct-to-R2 audio transfer needs CORS).
//
// Idempotent: run it whenever the set of allowed origins changes. Loads R2_* from .env.local.
//
//   R2_CORS_ORIGINS="http://localhost:3000,https://annotate.example.com" node scripts/set-r2-cors.mjs
//
// IMPORTANT — credentials: setting a bucket's CORS is a bucket-CONFIGURATION operation, not an
// object operation. The default R2 "Object Read & Write" token gets `AccessDenied (403)` here.
// You need a token with bucket configuration / admin rights (or just use the Cloudflare
// dashboard: R2 → your bucket → Settings → CORS policy → paste the JSON this script prints).
//
// IMPORTANT — origins: R2 rejects port wildcards like `http://localhost:*` with "MalformedXML".
// List concrete origins instead (one line per dev port you use + your production URL). Default
// below is a single concrete localhost origin; override via R2_CORS_ORIGINS.

import { readFileSync } from 'node:fs';
import {
  S3Client,
  PutBucketCorsCommand,
  GetBucketCorsCommand,
} from '@aws-sdk/client-s3';

// ── load .env.local ──────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
}

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT } = env;
const endpoint = R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// Origins: env override (comma-separated) or a single concrete localhost default. Use concrete
// origins — R2 rejects port wildcards (http://localhost:*).
const origins = (process.env.R2_CORS_ORIGINS || env.R2_CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

console.log('Endpoint:', endpoint);
console.log('Bucket  :', R2_BUCKET);
console.log('Origins :', origins.join(', '));
console.log('');

const s3 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  // The AWS SDK (v3.7xx+) adds a CRC32 flexible-checksum to write requests by default. R2's
  // PutBucketCors handler rejects that envelope ("MalformedXML"), so only checksum when the
  // operation actually requires it.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const CORSConfiguration = {
  CORSRules: [
    {
      AllowedOrigins: origins,
      // GET = download audio; PUT = presigned upload; HEAD = existence/range checks.
      AllowedMethods: ['GET', 'PUT', 'HEAD'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600,
    },
  ],
};

try {
  await s3.send(new PutBucketCorsCommand({ Bucket: R2_BUCKET, CORSConfiguration }));
  console.log('✅ CORS policy applied.');
  const got = await s3.send(new GetBucketCorsCommand({ Bucket: R2_BUCKET }));
  console.log('Now set to:');
  console.log(JSON.stringify(got.CORSRules, null, 2));
} catch (err) {
  console.log(`❌ Failed to set CORS: ${err.name}: ${err.message}`);
  if (err.$metadata) console.log(`   http ${err.$metadata.httpStatusCode ?? '?'}`);
  process.exit(1);
}

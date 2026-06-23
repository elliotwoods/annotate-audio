// Temporary R2 connectivity check. Loads .env.local, then exercises the exact operations
// the API relies on: PUT, HEAD, GET, LIST, on the configured bucket. Safe + self-cleaning.
import { readFileSync } from 'node:fs';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

// ── load .env.local ──────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
}

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT } = env;
const endpoint = R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
console.log('Endpoint :', endpoint);
console.log('Bucket   :', R2_BUCKET);
console.log('Access id:', R2_ACCESS_KEY_ID?.slice(0, 6) + '…');
console.log('');

const s3 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const Key = `__healthcheck/${Date.now()}.txt`;
const Body = 'annotate-audio r2 healthcheck';

async function step(label, fn) {
  try {
    const r = await fn();
    console.log(`✅ ${label}`);
    return r;
  } catch (err) {
    console.log(`❌ ${label}`);
    console.log(`   ${err.name}: ${err.message}`);
    if (err.$metadata) console.log(`   http ${err.$metadata.httpStatusCode ?? '?'}`);
    throw err;
  }
}

try {
  await step('PUT  object', () =>
    s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key, Body, ContentType: 'text/plain' })),
  );
  await step('HEAD object', () => s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key })));
  const got = await step('GET  object', () =>
    s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key })),
  );
  const text = await got.Body.transformToString();
  console.log(`   round-trip body matches: ${text === Body}`);
  await step('LIST prefix', () =>
    s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: '__healthcheck/' })),
  );
  await step('DELETE object (cleanup)', () =>
    s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key })),
  );
  console.log('\nAll R2 operations succeeded — credentials and bucket are good. 🎉');
} catch {
  console.log('\nR2 check failed — see the first ❌ above.');
  process.exit(1);
}

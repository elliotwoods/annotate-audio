// One-off migration: backfill `ownerUid` (and `editors: []`) onto legacy project metas in R2.
//
// The pre-Firebase system stored no owner on projects/{id}/meta.json. The Firebase-auth model
// keys ownership on a Firebase uid: the library lists only sets whose ownerUid === you, and the
// admin panel manages sets by owner. This stamps every owner-less legacy set onto a chosen
// account so those sets (e.g. LAD, Violin Phase) appear in that owner's library and stay
// manageable. Existing share URLs keep working regardless — this only affects ownership.
//
// Idempotent: sets are only patched when they lack ownerUid (or --force to overwrite). Reads
// R2_* + FIREBASE_SERVICE_ACCOUNT from .env.local.
//
//   node scripts/migrate-owner.mjs --email elliot@kimchiandchips.com --dry-run
//   node scripts/migrate-owner.mjs --email elliot@kimchiandchips.com
//   node scripts/migrate-owner.mjs --uid <firebaseUid>            # skip the email lookup
//   node scripts/migrate-owner.mjs --email you@x.com --force      # re-stamp even sets that have an owner
//
// The target account must have signed in at least once so Firebase has a user record for the
// email (needed to resolve the uid). Or pass --uid directly.

import { readFileSync } from 'node:fs';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

// ── args ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name) => args.includes(`--${name}`);
const dryRun = has('dry-run');
const force = has('force');
const email = flag('email') || 'elliot@kimchiandchips.com';
let ownerUid = flag('uid');

// ── load .env.local ──────────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
}
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_ENDPOINT } = env;
const endpoint = R2_ENDPOINT || `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// ── resolve the owner uid (via Firebase Admin) unless given ───────────────────
if (!ownerUid) {
  const saJson = env.FIREBASE_SERVICE_ACCOUNT;
  if (!saJson) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT missing in .env.local (or pass --uid <uid>).');
    process.exit(1);
  }
  initializeApp({ credential: cert(JSON.parse(saJson)) });
  try {
    const user = await getAuth().getUserByEmail(email);
    ownerUid = user.uid;
    console.log(`Resolved ${email} → uid ${ownerUid}`);
  } catch (err) {
    console.error(`❌ Could not resolve ${email}: ${err.message}`);
    console.error('   The account must have signed in once, or pass --uid <uid> directly.');
    process.exit(1);
  }
}

// ── R2 client ──────────────────────────────────────────────────────────────────
const s3 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function listMetaKeys() {
  const keys = [];
  let token;
  do {
    const out = await s3.send(
      new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: 'projects/', ContinuationToken: token }),
    );
    for (const o of out.Contents ?? []) if (o.Key?.endsWith('/meta.json')) keys.push(o.Key);
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function readJSON(key) {
  const out = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  return JSON.parse(await out.Body.transformToString());
}

async function writeJSON(key, value) {
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: JSON.stringify(value, null, 2),
      ContentType: 'application/json',
    }),
  );
}

// ── run ────────────────────────────────────────────────────────────────────────
console.log(`Bucket: ${R2_BUCKET}   owner: ${ownerUid}   ${dryRun ? '(dry run)' : ''}${force ? ' (force)' : ''}\n`);
const keys = await listMetaKeys();
console.log(`Found ${keys.length} project meta files.\n`);

let patched = 0;
let skipped = 0;
for (const key of keys) {
  const meta = await readJSON(key);
  const needsOwner = force || !meta.ownerUid;
  const needsEditors = !Array.isArray(meta.editors);
  if (!needsOwner && !needsEditors) {
    skipped++;
    continue;
  }
  const before = { ownerUid: meta.ownerUid ?? '(none)', editors: meta.editors ?? '(none)' };
  if (needsOwner) meta.ownerUid = ownerUid;
  if (needsEditors) meta.editors = [];
  console.log(
    `${dryRun ? 'WOULD PATCH' : 'PATCH'} ${key}  "${meta.name}"  ownerUid ${before.ownerUid} → ${meta.ownerUid}`,
  );
  if (!dryRun) await writeJSON(key, meta);
  patched++;
}

console.log(`\n${dryRun ? 'Would patch' : 'Patched'} ${patched}, skipped ${skipped}.`);
if (dryRun) console.log('Re-run without --dry-run to apply.');

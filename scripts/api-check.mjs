// Temporary admin-key check. Bundles the REAL handlers (api/auth/verify.ts and
// api/projects/index.ts) with esbuild, loads .env.local into process.env, and exercises:
//   1. verify  — correct key      → 200 { ok:true }
//   2. verify  — wrong key        → 401
//   3. create  — no admin bearer  → 401 (admin gate)
//   4. create  — correct bearer   → 201, then deletes the test objects from R2
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import {
  S3Client,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

// ── load .env.local into process.env (the handlers read process.env) ──────────
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
  if (m && !line.trim().startsWith('#')) process.env[m[1]] = m[2];
}

// ── bundle the handlers (transpile our TS; keep aws-sdk external) ──────────────
const outdir = 'scripts/.tmp';
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: { verify: 'api/auth/verify.ts', projects: 'api/projects/index.ts' },
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  external: ['@aws-sdk/*'],
  logLevel: 'silent',
});
const verify = (await import(pathToFileURL(`${process.cwd()}/${outdir}/verify.js`))).default;
const createProjects = (await import(pathToFileURL(`${process.cwd()}/${outdir}/projects.js`))).default;

// ── mock req/res ──────────────────────────────────────────────────────────────
function mockRes() {
  return {
    statusCode: 200,
    body: null,
    _headers: {},
    setHeader(k, v) { this._headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
}
const call = async (handler, req) => { const res = mockRes(); await handler(req, res); return res; };

let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? `  — ${detail}` : ''}`);
  ok ? pass++ : fail++;
}

const KEY = process.env.ADMIN_KEY;
console.log(`ADMIN_KEY loaded: ${KEY ? `"${KEY}" (${KEY.length} chars)` : 'MISSING'}\n`);

// 1. correct key
let r = await call(verify, { method: 'POST', headers: {}, query: {}, body: { key: KEY } });
check('verify accepts the correct key', r.statusCode === 200 && r.body?.ok === true,
  `status ${r.statusCode} ${JSON.stringify(r.body)}`);

// 2. wrong key
r = await call(verify, { method: 'POST', headers: {}, query: {}, body: { key: KEY + 'x' } });
check('verify rejects a wrong key', r.statusCode === 401,
  `status ${r.statusCode}`);

// 3. create without admin bearer → 401
const project = {
  schemaVersion: 1, id: `__admincheck-${Date.now()}`, name: 'Admin Key Test',
  audio: null, grid: { bpm: 120, offset: 0, beatsPerBar: 4, beatUnit: 4 },
  rows: [], blocks: [],
  view: {
    pixelsPerSecond: 100, scrollSec: 0, followPlayhead: false,
    snap: { enabled: true, cues: true, grid: 'bar' },
  },
  updatedAt: Date.now(),
};
r = await call(createProjects, { method: 'POST', headers: {}, query: {}, body: project });
check('create is blocked without the admin key', r.statusCode === 401,
  `status ${r.statusCode}`);

// 4. create WITH admin bearer → 201, then clean up R2
r = await call(createProjects, {
  method: 'POST', headers: { authorization: `Bearer ${KEY}` }, query: {}, body: project,
});
const created = r.statusCode === 201 && r.body?.editToken && r.body?.viewToken;
check('create succeeds with the admin key (real R2 write)', created,
  `status ${r.statusCode} ${created ? `tokens issued, snapshot ${r.body.latest}` : JSON.stringify(r.body)}`);

if (created) {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });
  const Bucket = process.env.R2_BUCKET;
  for (const Key of [`projects/${project.id}/snapshots/${r.body.latest}.json`, `projects/${project.id}/meta.json`]) {
    await s3.send(new DeleteObjectCommand({ Bucket, Key })).catch(() => {});
  }
  console.log('   (cleaned up test objects from R2)');
}

rmSync(outdir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '🎉 admin key works properly' : '⚠️  admin key check failed'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

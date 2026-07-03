// One-shot Firebase provisioning for the annotate-audio project, driven by YOUR gcloud login.
// Run it yourself (it performs cloud-infra changes, so it shouldn't be run by the agent):
//
//   node scripts/provision-firebase.mjs                 # defaults to project annotate-audio-app
//   node scripts/provision-firebase.mjs <projectId> <rtdbLocation>
//
// It: adds Firebase to the project, creates a Web app + reads its SDK config, creates the
// default Realtime Database, mints a firebase-adminsdk service-account key, and writes all the
// NEXT_PUBLIC_FIREBASE_* + FIREBASE_SERVICE_ACCOUNT values into .env.local (preserving your
// existing R2_* lines). Google sign-in must be toggled on in the console (it prints the link) —
// that one step isn't reliably automatable.
//
// Prereq: `gcloud auth login` as an owner of the project (you've done this).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PROJECT = process.argv[2] || 'annotate-audio-app';
const RTDB_LOCATION = process.argv[3] || 'us-central1';

// ── locate gcloud (not always on PATH) ─────────────────────────────────────────
function findGcloud() {
  const candidates = [
    'gcloud',
    `${process.env.LOCALAPPDATA}\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd`,
    'C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd',
    'C:\\Program Files\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd',
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ['--version'], { stdio: 'ignore' });
      return c;
    } catch {
      /* try next */
    }
  }
  throw new Error('gcloud not found — pass its path or add it to PATH.');
}
const GCLOUD = findGcloud();
const token = () => execFileSync(GCLOUD, ['auth', 'print-access-token']).toString().trim();

// ── REST helper (Node 18+ global fetch), with the project as quota project ─────
async function api(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      'X-Goog-User-Project': PROJECT,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

/** Poll a long-running operation to completion; returns its `response`. */
async function awaitOp(op) {
  if (!op?.name) return op;
  for (let i = 0; i < 60; i++) {
    const { json } = await api(`https://firebase.googleapis.com/v1/${op.name}`);
    if (json.done) {
      if (json.error) throw new Error(JSON.stringify(json.error));
      return json.response;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`operation ${op.name} timed out`);
}

async function main() {
  console.log(`Project: ${PROJECT}  (gcloud: ${GCLOUD})\n`);

  // 1. Add Firebase to the project (idempotent).
  process.stdout.write('1/5 Adding Firebase… ');
  {
    const { ok, json } = await api(
      `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}:addFirebase`,
      { method: 'POST', body: {} },
    );
    if (ok) await awaitOp(json).catch(() => {});
    console.log(ok || json.error?.status === 'ALREADY_EXISTS' ? 'ok' : `note: ${json.error?.message ?? ''}`);
  }

  // 2. Create a Web app + read its SDK config.
  process.stdout.write('2/5 Web app + config… ');
  let appId;
  {
    const list = await api(`https://firebase.googleapis.com/v1beta1/projects/${PROJECT}/webApps`);
    appId = list.json.apps?.[0]?.appId;
    if (!appId) {
      const created = await api(
        `https://firebase.googleapis.com/v1beta1/projects/${PROJECT}/webApps`,
        { method: 'POST', body: { displayName: 'Annotate Audio' } },
      );
      const resp = await awaitOp(created.json);
      appId = resp.appId;
    }
  }
  const cfg = (await api(`https://firebase.googleapis.com/v1beta1/projects/${PROJECT}/webApps/${appId}/config`)).json;
  console.log(`ok (appId ${appId})`);

  // 3. Create the default Realtime Database (best-effort — needs an eligible plan).
  process.stdout.write('3/5 Realtime Database… ');
  let databaseURL = cfg.databaseURL;
  {
    const dbId = `${PROJECT}-default`;
    const r = await api(
      `https://firebasedatabase.googleapis.com/v1beta/projects/${PROJECT}/locations/${RTDB_LOCATION}/instances?databaseId=${dbId}`,
      { method: 'POST', body: { type: 'DEFAULT_DATABASE' } },
    );
    if (r.ok || r.json?.name) {
      databaseURL = r.json.databaseUrl || `https://${dbId}-rtdb.${RTDB_LOCATION}.firebasedatabase.app`;
      console.log('ok');
    } else if (r.json.error?.status === 'ALREADY_EXISTS') {
      console.log('already exists');
    } else {
      console.log(`skipped (${r.json.error?.message ?? r.status}) — create it in the console if you want live cursors`);
    }
  }

  // 4. Mint a service-account key for the firebase-adminsdk account.
  process.stdout.write('4/5 Service-account key… ');
  const saEmail = `firebase-adminsdk-fbsvc@${PROJECT}.iam.gserviceaccount.com`;
  let serviceAccount = '';
  {
    // Discover the actual adminsdk SA (email suffix varies).
    const accounts = execFileSync(GCLOUD, [
      'iam', 'service-accounts', 'list', `--project=${PROJECT}`, '--format=value(email)',
    ]).toString().split(/\r?\n/).filter(Boolean);
    const email = accounts.find((a) => a.includes('firebase-adminsdk')) || saEmail;
    const key = await api(
      `https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts/${email}/keys`,
      { method: 'POST', body: { privateKeyType: 'TYPE_GOOGLE_CREDENTIALS_FILE' } },
    );
    if (key.json.privateKeyData) {
      const decoded = Buffer.from(key.json.privateKeyData, 'base64').toString('utf8');
      serviceAccount = JSON.stringify(JSON.parse(decoded)); // compact → single .env line
      console.log(`ok (${email})`);
    } else {
      console.log(`FAILED (${key.json.error?.message ?? key.status}) — generate a key in the console`);
    }
  }

  // 5. Write .env.local (preserve existing non-Firebase lines).
  process.stdout.write('5/5 Writing .env.local… ');
  const vars = {
    NEXT_PUBLIC_FIREBASE_API_KEY: cfg.apiKey,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: cfg.authDomain,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: cfg.projectId,
    NEXT_PUBLIC_FIREBASE_APP_ID: cfg.appId,
    NEXT_PUBLIC_FIREBASE_DATABASE_URL: databaseURL || '',
    FIREBASE_SERVICE_ACCOUNT: serviceAccount,
  };
  const managed = new Set(Object.keys(vars));
  const existing = existsSync('.env.local') ? readFileSync('.env.local', 'utf8').split(/\r?\n/) : [];
  const kept = existing.filter((l) => {
    const k = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(l)?.[1];
    return !k || !managed.has(k);
  });
  const added = Object.entries(vars)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`);
  writeFileSync('.env.local', [...kept.filter((l) => l.trim() !== ''), '', '# Firebase (auth + realtime)', ...added, ''].join('\n'));
  console.log('ok\n');

  console.log('── Next ────────────────────────────────────────────────────────────');
  console.log(`• Enable Google sign-in (one console toggle):`);
  console.log(`    https://console.firebase.google.com/project/${PROJECT}/authentication/providers`);
  console.log(`    → Google → Enable → set support email → Save.`);
  console.log(`  Then add your Vercel domains under Authentication → Settings → Authorized domains.`);
  console.log(`• Set the project id in .firebaserc, then: firebase login --reauth && firebase deploy --only database`);
  console.log(`• Tell the agent it's done — it will push these env vars to Vercel and deploy.`);
}

main().catch((e) => {
  console.error('\n❌', e.message);
  process.exit(1);
});

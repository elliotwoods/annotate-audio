// Firebase Admin SDK bootstrap (server-only).
//
// One initialized app, shared by the storage layer (src/server/storage.ts) and auth
// (src/server/auth.ts). Credentials come from Application Default Credentials:
//   • On Firebase App Hosting / Cloud Run the runtime service account supplies ADC and the
//     project id automatically — no key file, nothing to configure.
//   • Locally, either run `gcloud auth application-default login`, or set
//     GOOGLE_APPLICATION_CREDENTIALS to a service-account key file, or paste the key JSON
//     into FIREBASE_SERVICE_ACCOUNT.
//
// The Admin SDK runs with privileged access and BYPASSES Storage / RTDB security rules.

import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';

/** Default bucket for project JSON + audio blobs (e.g. "my-project.appspot.com"). */
const STORAGE_BUCKET =
  process.env.STORAGE_BUCKET || process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || undefined;

let app: App | null = null;

/** Lazily initialize (and memoize) the single Admin app. */
export function adminApp(): App {
  if (app) return app;
  const existing = getApps();
  if (existing.length) {
    app = existing[0];
    return app;
  }
  const saJson = process.env.FIREBASE_SERVICE_ACCOUNT;
  app = initializeApp({
    // With no `credential`, the Admin SDK uses Application Default Credentials.
    ...(saJson ? { credential: cert(JSON.parse(saJson)) } : {}),
    storageBucket: STORAGE_BUCKET,
  });
  return app;
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

/** The default Cloud Storage bucket handle (typed via inference to avoid a direct
 *  @google-cloud/storage import; firebase-admin owns that dependency). */
export function adminBucket() {
  return getStorage(adminApp()).bucket(STORAGE_BUCKET);
}

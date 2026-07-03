// Firebase Admin SDK bootstrap (server-only).
//
// Firebase is used ONLY for AUTH here: verifying user ID tokens and minting the per-project
// realtime custom tokens. Object storage lives on Cloudflare R2 (src/server/r2.ts), not GCS.
//
// Credentials:
//   • On Vercel (and most hosts): set FIREBASE_SERVICE_ACCOUNT to the service-account key
//     JSON (the whole object, inline). We pass it via cert().
//   • Locally you may instead use Application Default Credentials
//     (`gcloud auth application-default login`) or GOOGLE_APPLICATION_CREDENTIALS.

import { getApps, initializeApp, cert, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';

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
    // With no `credential`, the Admin SDK falls back to Application Default Credentials.
    ...(saJson ? { credential: cert(JSON.parse(saJson)) } : {}),
  });
  return app;
}

export function adminAuth(): Auth {
  return getAuth(adminApp());
}

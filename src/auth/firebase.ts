// Client-side Firebase bootstrap (browser-only).
//
// Holds the public Firebase web config (from NEXT_PUBLIC_FIREBASE_* build vars) and lazily
// initializes the PRIMARY app + Auth used for user sign-in. Initialization is lazy so this
// module is import-safe during SSR/prerender (the editor itself is ssr:false).
//
// The realtime layer (persistence/realtime.ts) deliberately spins up a SEPARATE secondary app
// for its per-project custom-token sign-in, so it never clobbers this primary Google session.

import { getApps, getApp, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

export const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
};

/** True when the minimal config for auth is present (so the UI can hide cloud features). */
export function hasFirebaseConfig(): boolean {
  return !!(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId
  );
}

/** True when the Realtime Database is configured (live collaboration possible). */
export function hasRealtimeConfig(): boolean {
  return hasFirebaseConfig() && !!firebaseConfig.databaseURL;
}

let app: FirebaseApp | null = null;

/** The primary Firebase app, initialized on first use. */
export function firebaseApp(): FirebaseApp {
  if (app) return app;
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return app;
}

let auth: Auth | null = null;

/** The primary Auth instance (carries the signed-in user whose ID token authorizes the API). */
export function firebaseAuth(): Auth {
  if (!auth) auth = getAuth(firebaseApp());
  return auth;
}

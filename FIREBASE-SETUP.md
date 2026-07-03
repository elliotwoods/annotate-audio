# Firebase setup (auth + realtime) — one-time

Login can't work until a Firebase project exists and its config is wired in. Storage stays on
Cloudflare R2; Firebase is used **only** for Google sign-in + the Realtime Database (cursors /
live collaboration). ~10 minutes in the Firebase console, then hand the values back and the
deploy is one command.

## 1. Create / pick a Firebase project
- https://console.firebase.google.com → **Add project** (or reuse an existing one).

## 2. Enable Google sign-in
- **Build → Authentication → Get started → Sign-in method → Google → Enable → Save.**
- **Authentication → Settings → Authorized domains**: add your Vercel domains and localhost,
  e.g. `annotate-audio.vercel.app`, `annotate-audio-kimchiandchips.vercel.app`, `localhost`.
  (Google sign-in popups are rejected from unlisted domains.)

## 3. Create the Realtime Database
- **Build → Realtime Database → Create Database** → pick a region → start in **locked mode**
  (our rules in `database.rules.json` are deployed in step 6). Note the DB URL, e.g.
  `https://<project>-default-rtdb.<region>.firebasedatabase.app`.

## 4. Get the web (client) config
- **Project settings (gear) → General → Your apps → Web app** (create one if none) → copy:
  `apiKey`, `authDomain`, `projectId`, `appId`. (`databaseURL` = the URL from step 3.)

## 5. Get a service-account key (server)
- **Project settings → Service accounts → Generate new private key** → downloads a JSON file.
  This whole JSON is `FIREBASE_SERVICE_ACCOUNT` (paste it as a single line / one env value).

## 6. Wire it up locally + deploy rules
Add to `.env.local` (see `.env.example` for the full list):
```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=<project>.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=<project>
NEXT_PUBLIC_FIREBASE_APP_ID=...
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://<project>-default-rtdb.<region>.firebasedatabase.app
FIREBASE_SERVICE_ACCOUNT={"type":"service_account",...}   # the whole JSON, one line
```
Set the project id in `.firebaserc` (replace the placeholder), then:
```
firebase login --reauth          # your CLI creds are currently expired (run this yourself)
firebase deploy --only database  # pushes database.rules.json
```

## 7. R2 CORS for the production origin (audio upload/download)
```
R2_CORS_ORIGINS="https://annotate-audio.vercel.app,http://localhost:3000" node scripts/set-r2-cors.mjs
```

## 8. Set the same env on Vercel + deploy
- Add every `NEXT_PUBLIC_FIREBASE_*` and `FIREBASE_SERVICE_ACCOUNT` to the Vercel project's
  Environment Variables (the `R2_*` are already there). Then `vercel --prod`.
- (Or paste the values back to me — I'm authenticated to the Vercel CLI and can set them +
  deploy the `fix-r2-firebase-hybrid` branch for you.)

## 9. Bootstrap admin + migrate legacy sets
- Sign in once as `elliot@kimchiandchips.com` (bootstrap admin — see `ADMIN_EMAILS` in
  `src/server/auth.ts`).
- Backfill ownership on pre-existing sets so LAD / Violin Phase appear in your library:
```
node scripts/migrate-owner.mjs --email elliot@kimchiandchips.com --dry-run
node scripts/migrate-owner.mjs --email elliot@kimchiandchips.com
```

---
**Interim option:** if you need login working *today* without the Firebase setup, the old
`ADMIN_KEY` password sign-in can be restored (you already have that secret on Vercel). Ask and
I'll wire it as a stopgap, with Firebase Google auth layered on once the project exists.

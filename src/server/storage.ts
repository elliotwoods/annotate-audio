// Object-storage seam (server-only).
//
// The route handlers and src/server/meta.ts import the object-store interface from this
// stable '@server/storage' path; the concrete backend is Cloudflare R2 (src/server/r2.ts).
// Keeping this as a thin re-export means the backend can be swapped without touching any
// caller. (Firebase is used ONLY for auth — see src/server/firebaseAdmin.ts — not storage.)
//
// Object layout (see src/server/meta.ts and the route handlers):
//   projects/{id}/meta.json
//   projects/{id}/snapshots/{ts}-{rand}.json
//   audio/{sha256}

export { getJSON, putJSON, objectExists, listKeys, presignPut, presignGet, BUCKET } from './r2';

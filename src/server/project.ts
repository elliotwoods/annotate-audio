// Lightweight server-side structural checks for incoming Project JSON.
//
// The client already does full validation/normalization on load (src/persistence/json.ts
// validateProject). The server only needs cheap sanity + invariant guards so a malformed
// or oversized body can't poison a snapshot. We deliberately keep this independent of the
// app's (DOM-coupled, strict-tsconfig) source tree.

export interface IncomingProject {
  schemaVersion: 1;
  id: string;
  name: string;
  audio: { hash: string; fileName?: string } | null;
  rows: unknown[];
  blocks: unknown[];
  [k: string]: unknown;
}

const SCHEMA_VERSION = 1;

/** ~8 MB ceiling on a single project JSON (cues are tiny; this is generous). */
export const MAX_PROJECT_BYTES = 8 * 1024 * 1024;

export function parseProject(body: unknown): IncomingProject {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Project body must be a JSON object.');
  }
  const p = body as Record<string, unknown>;
  if (p.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported schemaVersion (expected ${SCHEMA_VERSION}).`);
  }
  if (typeof p.id !== 'string' || !p.id) throw new Error('Project "id" must be a non-empty string.');
  if (typeof p.name !== 'string') throw new Error('Project "name" must be a string.');
  if (!Array.isArray(p.rows)) throw new Error('Project "rows" must be an array.');
  if (!Array.isArray(p.blocks)) throw new Error('Project "blocks" must be an array.');

  let audioHash: string | null = null;
  if (p.audio !== null && p.audio !== undefined) {
    if (typeof p.audio !== 'object') throw new Error('Project "audio" must be an object or null.');
    const hash = (p.audio as Record<string, unknown>).hash;
    if (typeof hash !== 'string' || !hash) throw new Error('Project "audio.hash" must be a string.');
    audioHash = hash;
  }

  return { ...(p as IncomingProject), audio: audioHash ? (p.audio as IncomingProject['audio']) : null };
}

/** The content hash referenced by a project (or null). */
export function audioHashOf(p: IncomingProject): string | null {
  return p.audio?.hash ?? null;
}

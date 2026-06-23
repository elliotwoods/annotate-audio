// /api/projects
//   GET  — admin only — list all cloud sets (id, name, updatedAt) for the library.
//   POST — admin only — create a new cloud project from a Project body. Generates the
//          view/edit tokens + writes meta.json and the first immutable snapshot.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAdmin } from '../_lib/auth';
import { makeToken } from '../_lib/tokens';
import {
  readMeta,
  writeMeta,
  metaKey,
  snapshotKey,
  type ProjectMeta,
} from '../_lib/meta';
import { getJSON, putJSON, listKeys } from '../_lib/r2';
import { parseProject, audioHashOf, MAX_PROJECT_BYTES } from '../_lib/project';
import { newSnapId } from '../_lib/snapId';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Admin key required.' });

  try {
    if (req.method === 'GET') return await list(res);
    if (req.method === 'POST') return await create(req, res);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}

async function list(res: VercelResponse) {
  const metaKeys = (await listKeys('projects/')).filter((k) => k.endsWith('/meta.json'));
  const metas = await Promise.all(metaKeys.map((k) => getJSON<ProjectMeta>(k)));
  const sets = metas
    .filter((m): m is ProjectMeta => !!m)
    .map((m) => ({ id: m.id, name: m.name, updatedAt: m.updatedAt, createdAt: m.createdAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return res.status(200).json({ projects: sets });
}

async function create(req: VercelRequest, res: VercelResponse) {
  if (sizeOf(req.body) > MAX_PROJECT_BYTES) {
    return res.status(413).json({ error: 'Project is too large.' });
  }
  const project = parseProject(req.body);

  // Reuse the client's existing UUID as the cloud id. Refuse to clobber an existing set.
  if (await readMeta(project.id)) {
    return res.status(409).json({ error: 'A cloud project with this id already exists.' });
  }

  const ts = Date.now();
  const snapId = newSnapId(ts);
  await putJSON(snapshotKey(project.id, snapId), project);

  const meta: ProjectMeta = {
    id: project.id,
    name: project.name,
    audioHash: audioHashOf(project),
    viewToken: makeToken(),
    editToken: makeToken(),
    latest: snapId,
    createdAt: ts,
    updatedAt: ts,
  };
  await writeMeta(meta);

  return res.status(201).json({
    id: meta.id,
    viewToken: meta.viewToken,
    editToken: meta.editToken,
    latest: snapId,
    metaKey: metaKey(meta.id),
  });
}

function sizeOf(body: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(body));
  } catch {
    return 0;
  }
}

// GET /api/projects/[id]?token=&snapshot= — load a set (view/edit/admin).
// Returns { meta, project } where project is the requested snapshot (default: latest).
// `meta` is the public-safe subset (no tokens unless the caller is admin/edit).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { accessLevel, canView, canEdit } from '../../_lib/auth';
import { readMeta, snapshotKey, type ProjectMeta } from '../../_lib/meta';
import { getJSON } from '../../_lib/r2';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const id = String(req.query.id);
  try {
    const meta = await readMeta(id);
    if (!meta) return res.status(404).json({ error: 'Project not found.' });

    const access = accessLevel(req, meta);
    if (!canView(access)) return res.status(401).json({ error: 'Not authorized for this project.' });

    const snapParam = req.query.snapshot;
    const snapId = typeof snapParam === 'string' && snapParam ? snapParam : meta.latest;
    if (!snapId) return res.status(404).json({ error: 'Project has no snapshots.' });

    const project = await getJSON<unknown>(snapshotKey(id, snapId));
    if (!project) return res.status(404).json({ error: 'Snapshot not found.' });

    return res.status(200).json({ meta: publicMeta(meta, canEdit(access)), snapshot: snapId, project });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}

/** Strip tokens unless the caller may edit (edit links/admin already hold them). */
function publicMeta(m: ProjectMeta, withTokens: boolean) {
  const base = {
    id: m.id,
    name: m.name,
    audioHash: m.audioHash,
    latest: m.latest,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
  return withTokens ? { ...base, viewToken: m.viewToken, editToken: m.editToken } : base;
}

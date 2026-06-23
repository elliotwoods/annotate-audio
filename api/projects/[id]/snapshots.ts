// /api/projects/[id]/snapshots
//   GET  — view/edit/admin — list snapshots (id, createdAt, size), newest first.
//   POST — edit/admin       — append a NEW immutable snapshot (never overwrites) and
//          advance meta.latest / updatedAt / name / audioHash.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { accessLevel, canView, canEdit } from '../../_lib/auth';
import {
  readMeta,
  writeMeta,
  snapshotKey,
  snapshotPrefix,
  snapIdFromKey,
  snapTimestamp,
} from '../../_lib/meta';
import { putJSON, listKeys } from '../../_lib/r2';
import { parseProject, audioHashOf, MAX_PROJECT_BYTES } from '../../_lib/project';
import { newSnapId } from '../../_lib/snapId';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = String(req.query.id);
  try {
    const meta = await readMeta(id);
    if (!meta) return res.status(404).json({ error: 'Project not found.' });
    const access = accessLevel(req, meta);

    if (req.method === 'GET') {
      if (!canView(access)) return res.status(401).json({ error: 'Not authorized.' });
      const keys = await listKeys(snapshotPrefix(id));
      const snapshots = keys
        .map((k) => snapIdFromKey(k))
        .map((sid) => ({ id: sid, createdAt: snapTimestamp(sid) }))
        .sort((a, b) => b.createdAt - a.createdAt);
      return res.status(200).json({ snapshots, latest: meta.latest });
    }

    if (req.method === 'POST') {
      if (!canEdit(access)) return res.status(401).json({ error: 'Edit access required.' });
      if (sizeOf(req.body) > MAX_PROJECT_BYTES) {
        return res.status(413).json({ error: 'Project is too large.' });
      }
      const project = parseProject(req.body);
      const ts = Date.now();
      const snapId = newSnapId(ts);
      await putJSON(snapshotKey(id, snapId), project);

      await writeMeta({
        ...meta,
        name: project.name,
        audioHash: audioHashOf(project),
        latest: snapId,
        updatedAt: ts,
      });
      return res.status(201).json({ snapshotId: snapId, createdAt: ts });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}

function sizeOf(body: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(body));
  } catch {
    return 0;
  }
}

// GET /api/audio/[hash]?p=<projectId>&token=<view-or-edit> — return a presigned GET URL
// for the audio blob. Authorized by view access on the referencing project (or admin).
// The browser then fetches the blob directly from R2 and caches it locally by hash.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAdmin, accessLevel, canView } from '../_lib/auth';
import { readMeta } from '../_lib/meta';
import { objectExists, presignGet } from '../_lib/r2';
import { audioKey, isValidHash } from '../_lib/audio';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const hash = String(req.query.hash);
  if (!isValidHash(hash)) return res.status(400).json({ error: 'Invalid audio hash.' });

  try {
    if (!isAdmin(req)) {
      const projectId = typeof req.query.p === 'string' ? req.query.p : '';
      if (!projectId) return res.status(400).json({ error: 'project (p) required.' });
      const meta = await readMeta(projectId);
      if (!meta) return res.status(404).json({ error: 'Project not found.' });
      if (!canView(accessLevel(req, meta))) {
        return res.status(401).json({ error: 'Not authorized.' });
      }
    }

    const key = audioKey(hash);
    if (!(await objectExists(key))) return res.status(404).json({ error: 'Audio not found.' });

    const url = await presignGet(key);
    return res.status(200).json({ url });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}

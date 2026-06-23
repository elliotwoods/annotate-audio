// POST /api/audio/upload-url?token=<edit-or-omit-for-admin>
// Body: { projectId, hash, contentType }
//
// Audio blobs are deduplicated by content hash at audio/{hash} and uploaded by the browser
// DIRECTLY to R2 (bypassing the function body-size limit). This endpoint authorizes the
// caller (edit on the project, or admin) and either reports the blob already exists or
// returns a short-lived presigned PUT URL.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { isAdmin, accessLevel, canEdit } from '../_lib/auth';
import { readMeta } from '../_lib/meta';
import { objectExists, presignPut } from '../_lib/r2';
import { audioKey, isValidHash } from '../_lib/audio';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const body = (req.body ?? {}) as { projectId?: string; hash?: string; contentType?: string };
  const { projectId, hash, contentType } = body;
  if (!hash || !isValidHash(hash)) return res.status(400).json({ error: 'Invalid audio hash.' });

  try {
    if (!isAdmin(req)) {
      if (!projectId) return res.status(400).json({ error: 'projectId required.' });
      const meta = await readMeta(projectId);
      if (!meta) return res.status(404).json({ error: 'Project not found.' });
      if (!canEdit(accessLevel(req, meta))) {
        return res.status(401).json({ error: 'Edit access required.' });
      }
    }

    const key = audioKey(hash);
    if (await objectExists(key)) return res.status(200).json({ exists: true });

    const url = await presignPut(key, contentType || 'application/octet-stream');
    return res.status(200).json({ exists: false, url });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}

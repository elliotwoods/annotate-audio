// GET/POST /api/realtime/token?projectId=<id>&cid=<clientId>&token=<share-token>
//
// Ably token-auth endpoint. The browser's Ably client calls this (via authUrl) to obtain a
// short-lived capability token instead of ever seeing the Ably API key. Authorization reuses
// the existing project model: admins (bearer ADMIN_KEY) and edit-token holders get publish +
// subscribe + presence; view-token holders get subscribe + presence only (so view-only links
// are genuinely read-only at the realtime layer too).
//
// Returns 501 when ABLY_API_KEY is unset so the client can degrade to a no-op (no collab).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import Ably from 'ably';
import { accessLevel, canView, canEdit } from '../_lib/auth';
import { readMeta } from '../_lib/meta';

/** Read a param from the query string, falling back to a parsed body. */
function param(req: VercelRequest, key: string): string | null {
  const fromQuery = req.query?.[key];
  if (typeof fromQuery === 'string') return fromQuery;
  if (Array.isArray(fromQuery) && typeof fromQuery[0] === 'string') return fromQuery[0];
  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = body?.[key];
  return typeof fromBody === 'string' ? fromBody : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env.ABLY_API_KEY;
  if (!apiKey) return res.status(501).json({ error: 'Realtime is not configured.' });

  const projectId = param(req, 'projectId');
  if (!projectId) return res.status(400).json({ error: 'projectId required.' });

  try {
    const meta = await readMeta(projectId);
    if (!meta) return res.status(404).json({ error: 'Project not found.' });

    const access = accessLevel(req, meta);
    if (!canView(access)) return res.status(401).json({ error: 'Not authorized.' });

    const channel = `project:${projectId}`;
    const ops = canEdit(access)
      ? ['publish', 'subscribe', 'presence']
      : ['subscribe', 'presence'];
    const clientId = param(req, 'cid') ?? 'anon';

    const rest = new Ably.Rest({ key: apiKey });
    const tokenRequest = await rest.auth.createTokenRequest({
      clientId,
      capability: JSON.stringify({ [channel]: ops }),
    });
    return res.status(200).json(tokenRequest);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}

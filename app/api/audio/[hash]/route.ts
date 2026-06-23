// GET /api/audio/[hash]?p=<projectId>&token=<view-or-edit> — return a presigned GET URL
// for the audio blob. Authorized by view access on the referencing project (or admin).
// The browser then fetches the blob directly from R2 and caches it locally by hash.

import { NextResponse, type NextRequest } from 'next/server';
import { isAdmin, accessLevel, canView } from '@server/auth';
import { readMeta } from '@server/meta';
import { objectExists, presignGet } from '@server/r2';
import { audioKey, isValidHash } from '@server/audio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { hash: string } }) {
  const hash = params.hash;
  if (!isValidHash(hash)) return NextResponse.json({ error: 'Invalid audio hash.' }, { status: 400 });

  try {
    if (!isAdmin(req)) {
      const projectId = req.nextUrl.searchParams.get('p') || '';
      if (!projectId) return NextResponse.json({ error: 'project (p) required.' }, { status: 400 });
      const meta = await readMeta(projectId);
      if (!meta) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
      if (!canView(accessLevel(req, meta))) {
        return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
      }
    }

    const key = audioKey(hash);
    if (!(await objectExists(key))) return NextResponse.json({ error: 'Audio not found.' }, { status: 404 });

    const url = await presignGet(key);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

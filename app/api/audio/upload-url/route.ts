// POST /api/audio/upload-url?token=<edit-or-omit-for-admin>
// Body: { projectId, hash, contentType }
//
// Audio blobs are deduplicated by content hash at audio/{hash} and uploaded by the browser
// DIRECTLY to R2 (bypassing the function body-size limit). This endpoint authorizes the
// caller (edit on the project, or admin) and either reports the blob already exists or
// returns a short-lived presigned PUT URL.

import { NextResponse, type NextRequest } from 'next/server';
import { isAdmin, accessLevel, canEdit } from '@server/auth';
import { readMeta } from '@server/meta';
import { objectExists, presignPut } from '@server/r2';
import { audioKey, isValidHash } from '@server/audio';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    projectId?: string;
    hash?: string;
    contentType?: string;
  };
  const { projectId, hash, contentType } = body;
  if (!hash || !isValidHash(hash)) {
    return NextResponse.json({ error: 'Invalid audio hash.' }, { status: 400 });
  }

  try {
    if (!isAdmin(req)) {
      if (!projectId) return NextResponse.json({ error: 'projectId required.' }, { status: 400 });
      const meta = await readMeta(projectId);
      if (!meta) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
      if (!canEdit(accessLevel(req, meta))) {
        return NextResponse.json({ error: 'Edit access required.' }, { status: 401 });
      }
    }

    const key = audioKey(hash);
    if (await objectExists(key)) return NextResponse.json({ exists: true });

    const url = await presignPut(key, contentType || 'application/octet-stream');
    return NextResponse.json({ exists: false, url });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

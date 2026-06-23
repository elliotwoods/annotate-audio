// GET /api/projects/[id]?token=&snapshot= — load a set (view/edit/admin).
// Returns { meta, snapshot, project } where project is the requested snapshot (default:
// latest). `meta` is the public-safe subset (no tokens unless the caller is admin/edit).

import { NextResponse, type NextRequest } from 'next/server';
import { accessLevel, canView, canEdit } from '@server/auth';
import { readMeta, snapshotKey, type ProjectMeta } from '@server/meta';
import { getJSON } from '@server/r2';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  try {
    const meta = await readMeta(id);
    if (!meta) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

    const access = accessLevel(req, meta);
    if (!canView(access)) {
      return NextResponse.json({ error: 'Not authorized for this project.' }, { status: 401 });
    }

    const snapParam = req.nextUrl.searchParams.get('snapshot');
    const snapId = snapParam || meta.latest;
    if (!snapId) return NextResponse.json({ error: 'Project has no snapshots.' }, { status: 404 });

    const project = await getJSON<unknown>(snapshotKey(id, snapId));
    if (!project) return NextResponse.json({ error: 'Snapshot not found.' }, { status: 404 });

    return NextResponse.json({ meta: publicMeta(meta, canEdit(access)), snapshot: snapId, project });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
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

// /api/projects/[id]/snapshots
//   GET  — view/edit/admin — list snapshots (id, createdAt), newest first.
//   POST — edit/admin       — append a NEW immutable snapshot (never overwrites) and
//          advance meta.latest / updatedAt / name / audioHash.

import { NextResponse, type NextRequest } from 'next/server';
import { accessLevel, canView, canEdit } from '@server/auth';
import {
  readMeta,
  writeMeta,
  snapshotKey,
  snapshotPrefix,
  snapIdFromKey,
  snapTimestamp,
} from '@server/meta';
import { putJSON, listKeys } from '@server/storage';
import { parseProject, audioHashOf, MAX_PROJECT_BYTES } from '@server/project';
import { newSnapId } from '@server/snapId';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  try {
    const meta = await readMeta(id);
    if (!meta) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    if (!canView(await accessLevel(req, meta))) {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 401 });
    }
    const keys = await listKeys(snapshotPrefix(id));
    const snapshots = keys
      .map((k) => snapIdFromKey(k))
      .map((sid) => ({ id: sid, createdAt: snapTimestamp(sid) }))
      .sort((a, b) => b.createdAt - a.createdAt);
    return NextResponse.json({ snapshots, latest: meta.latest });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;
  try {
    const meta = await readMeta(id);
    if (!meta) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    if (!canEdit(await accessLevel(req, meta))) {
      return NextResponse.json({ error: 'Edit access required.' }, { status: 401 });
    }
    const body = await req.json().catch(() => null);
    if (sizeOf(body) > MAX_PROJECT_BYTES) {
      return NextResponse.json({ error: 'Project is too large.' }, { status: 413 });
    }
    const project = parseProject(body);
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
    return NextResponse.json({ snapshotId: snapId, createdAt: ts }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function sizeOf(body: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(body));
  } catch {
    return 0;
  }
}

// /api/projects
//   GET  — admin only — list all cloud sets (id, name, updatedAt) for the library.
//   POST — admin only — create a new cloud project from a Project body. Generates the
//          view/edit tokens + writes meta.json and the first immutable snapshot.

import { NextResponse, type NextRequest } from 'next/server';
import { verifyUid } from '@server/auth';
import { makeToken } from '@server/tokens';
import { readMeta, writeMeta, metaKey, snapshotKey, type ProjectMeta } from '@server/meta';
import { getJSON, putJSON, listKeys } from '@server/storage';
import { parseProject, audioHashOf, MAX_PROJECT_BYTES } from '@server/project';
import { newSnapId } from '@server/snapId';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const uid = await verifyUid(req);
  if (!uid) return NextResponse.json({ error: 'Sign-in required.' }, { status: 401 });
  try {
    const metaKeys = (await listKeys('projects/')).filter((k) => k.endsWith('/meta.json'));
    const metas = await Promise.all(metaKeys.map((k) => getJSON<ProjectMeta>(k)));
    const projects = metas
      .filter((m): m is ProjectMeta => !!m && m.ownerUid === uid)
      .map((m) => ({ id: m.id, name: m.name, updatedAt: m.updatedAt, createdAt: m.createdAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return NextResponse.json({ projects });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const uid = await verifyUid(req);
  if (!uid) return NextResponse.json({ error: 'Sign-in required.' }, { status: 401 });
  try {
    const body = await req.json().catch(() => null);
    if (sizeOf(body) > MAX_PROJECT_BYTES) {
      return NextResponse.json({ error: 'Project is too large.' }, { status: 413 });
    }
    const project = parseProject(body);

    // Reuse the client's existing UUID as the cloud id. Refuse to clobber an existing set.
    if (await readMeta(project.id)) {
      return NextResponse.json({ error: 'A cloud project with this id already exists.' }, { status: 409 });
    }

    const ts = Date.now();
    const snapId = newSnapId(ts);
    await putJSON(snapshotKey(project.id, snapId), project);

    const meta: ProjectMeta = {
      id: project.id,
      name: project.name,
      ownerUid: uid,
      editors: [],
      audioHash: audioHashOf(project),
      viewToken: makeToken(),
      editToken: makeToken(),
      latest: snapId,
      createdAt: ts,
      updatedAt: ts,
    };
    await writeMeta(meta);

    return NextResponse.json(
      { id: meta.id, viewToken: meta.viewToken, editToken: meta.editToken, latest: snapId, metaKey: metaKey(meta.id) },
      { status: 201 },
    );
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

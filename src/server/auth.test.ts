import { describe, it, expect } from 'vitest';
import { computeAccess, canView, canEdit } from './auth';
import type { ProjectMeta } from './meta';

const meta = (over: Partial<ProjectMeta> = {}): ProjectMeta => ({
  id: 'p1',
  name: 'Set',
  ownerUid: 'owner-uid',
  editors: [],
  audioHash: null,
  viewToken: 'VIEW',
  editToken: 'EDIT',
  latest: 's1',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

describe('computeAccess — invite / login-gated edit', () => {
  it('grants owner to the owning uid regardless of token', () => {
    expect(computeAccess('owner-uid', null, meta())).toBe('owner');
    expect(computeAccess('owner-uid', 'VIEW', meta())).toBe('owner');
  });

  it('grants edit to a uid already in editors (invite previously accepted)', () => {
    expect(computeAccess('u2', null, meta({ editors: ['u2'] }))).toBe('edit');
  });

  it('edit token is an INVITE: signed-in holder edits, anonymous holder is view-only', () => {
    expect(computeAccess('u3', 'EDIT', meta())).toBe('edit'); // logged in → edit
    expect(computeAccess(null, 'EDIT', meta())).toBe('view'); // anonymous → view only
  });

  it('view token grants view to anyone (anonymous ok)', () => {
    expect(computeAccess(null, 'VIEW', meta())).toBe('view');
    expect(computeAccess('u4', 'VIEW', meta())).toBe('view');
  });

  it('returns null with no matching credential', () => {
    expect(computeAccess(null, null, meta())).toBeNull();
    expect(computeAccess('nobody', 'WRONG', meta())).toBeNull();
  });

  it('tolerates legacy metas with no editors field', () => {
    const legacy = meta();
    delete (legacy as { editors?: string[] }).editors;
    expect(computeAccess('u5', 'EDIT', legacy)).toBe('edit');
    expect(computeAccess(null, 'EDIT', legacy)).toBe('view');
  });

  it('canView / canEdit derive correctly', () => {
    expect(canView('view')).toBe(true);
    expect(canEdit('view')).toBe(false);
    expect(canEdit('edit')).toBe(true);
    expect(canEdit('owner')).toBe(true);
    expect(canView(null)).toBe(false);
  });
});

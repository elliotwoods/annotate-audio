import { describe, it, expect } from 'vitest';
import { flattenRows, normalizeTree, isDescendant, subtreeIds } from './rowtree';
import type { Row, RowKind } from '../model/types';

function row(
  id: string,
  kind: RowKind,
  parentId: string | null = null,
  order = 0,
  collapsed = false,
): Row {
  return { id, kind, name: id, icon: 'x', color: '#fff', order, parentId, collapsed };
}

// track, section, group g1 {c1, c2}, top-level cue top
const base: Row[] = [
  row('t', 'track', null, 0),
  row('s', 'section', null, 1),
  row('g1', 'group', null, 2),
  row('c1', 'cue', 'g1', 0),
  row('c2', 'cue', 'g1', 1),
  row('top', 'cue', null, 3),
];

describe('flattenRows', () => {
  it('walks depth-first with correct depths', () => {
    const out = flattenRows(base);
    expect(out.map((v) => v.row.id)).toEqual(['t', 's', 'g1', 'c1', 'c2', 'top']);
    expect(out.map((v) => v.depth)).toEqual([0, 0, 0, 1, 1, 0]);
  });

  it('hides descendants of a collapsed group', () => {
    const rows = base.map((r) => (r.id === 'g1' ? { ...r, collapsed: true } : r));
    const out = flattenRows(rows);
    expect(out.map((v) => v.row.id)).toEqual(['t', 's', 'g1', 'top']);
  });

  it('surfaces orphans (dangling parentId) at top level rather than dropping them', () => {
    const rows = [...base, row('orphan', 'cue', 'ghost', 0)];
    const ids = flattenRows(rows).map((v) => v.row.id);
    expect(ids).toContain('orphan');
  });

  it('respects sibling order', () => {
    const rows = base.map((r) => (r.id === 'c1' ? { ...r, order: 5 } : r));
    const out = flattenRows(rows).filter((v) => v.row.parentId === 'g1').map((v) => v.row.id);
    expect(out).toEqual(['c2', 'c1']); // c2 (order1) now before c1 (order5)
  });
});

describe('normalizeTree', () => {
  it('pins track to 0 and section to 1 and orders top-level rest >= 2', () => {
    const rows = [
      row('g1', 'group', null, 9),
      row('s', 'section', null, 5),
      row('top', 'cue', null, 7),
      row('t', 'track', null, 8),
    ];
    const out = normalizeTree(rows);
    const byId = Object.fromEntries(out.map((r) => [r.id, r]));
    expect(byId.t.order).toBe(0);
    expect(byId.s.order).toBe(1);
    expect([byId.g1.order, byId.top.order].sort()).toEqual([2, 3]);
    expect(byId.t.parentId).toBeNull();
    expect(byId.s.parentId).toBeNull();
  });

  it('numbers nested children from 0', () => {
    const out = normalizeTree(base);
    const kids = out.filter((r) => r.parentId === 'g1').sort((a, b) => a.order - b.order);
    expect(kids.map((r) => r.order)).toEqual([0, 1]);
  });

  it('repairs a dangling parentId to null', () => {
    const out = normalizeTree([...base, row('x', 'cue', 'ghost', 0)]);
    expect(out.find((r) => r.id === 'x')!.parentId).toBeNull();
  });

  it('rejects a non-group parent (resets to null)', () => {
    const out = normalizeTree([...base, row('x', 'cue', 'c1', 0)]); // c1 is a cue, not a group
    expect(out.find((r) => r.id === 'x')!.parentId).toBeNull();
  });

  it('breaks a cycle between two groups (result is acyclic and both remain visible)', () => {
    const rows = [
      row('t', 'track', null, 0),
      row('s', 'section', null, 1),
      row('a', 'group', 'b', 2),
      row('b', 'group', 'a', 3),
    ];
    const out = normalizeTree(rows);
    // At least one link is severed so the graph is acyclic, and flatten terminates with both.
    expect(out.find((r) => r.id === 'a')!.parentId === null || out.find((r) => r.id === 'b')!.parentId === null).toBe(true);
    expect(isDescendant(out, 'a', 'a')).toBe(false);
    expect(isDescendant(out, 'b', 'b')).toBe(false);
    const ids = flattenRows(out).map((v) => v.row.id);
    expect(ids).toContain('a');
    expect(ids).toContain('b');
  });
});

describe('isDescendant', () => {
  it('detects nested descendants', () => {
    const rows = [
      row('g1', 'group', null, 2),
      row('g2', 'group', 'g1', 0),
      row('c', 'cue', 'g2', 0),
    ];
    expect(isDescendant(rows, 'g1', 'c')).toBe(true);
    expect(isDescendant(rows, 'g1', 'g2')).toBe(true);
    expect(isDescendant(rows, 'g2', 'g1')).toBe(false);
  });
});

describe('subtreeIds', () => {
  it('collects a group and all descendants', () => {
    const rows = [
      row('g1', 'group', null, 2),
      row('c1', 'cue', 'g1', 0),
      row('g2', 'group', 'g1', 1),
      row('c2', 'cue', 'g2', 0),
      row('out', 'cue', null, 3),
    ];
    expect([...subtreeIds(rows, 'g1')].sort()).toEqual(['c1', 'c2', 'g1', 'g2']);
  });
});

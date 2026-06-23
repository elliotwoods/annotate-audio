// Pure helpers for the row tree (spec: nested row groups/folders). Rows are stored FLAT
// with a `parentId` link; these functions interpret that flat list as a tree. No React,
// no audio, no Date/random — fully unit-testable. Shared by the store, selectors, and
// persistence so the tree rules live in exactly one place.

import type { Row } from '../model/types';

export interface VisibleRow {
  row: Row;
  depth: number; // 0 = top level; +1 per containing group
}

/** Group rows by parentId (null bucket = top level), each list sorted by `order`. */
function childrenByParent(rows: Row[]): Map<string | null, Row[]> {
  const map = new Map<string | null, Row[]>();
  for (const r of rows) {
    const key = r.parentId ?? null;
    let list = map.get(key);
    if (!list) {
      list = [];
      map.set(key, list);
    }
    list.push(r);
  }
  for (const list of map.values()) list.sort((a, b) => a.order - b.order);
  return map;
}

/**
 * Depth-first visible-row list: top level first (track/section by order), recursing into
 * each non-collapsed group. Defensive: any row not reachable from the root (dangling
 * parentId) is still emitted at depth 0 so nothing silently disappears.
 */
export function flattenRows(rows: Row[]): VisibleRow[] {
  const byParent = childrenByParent(rows);
  const out: VisibleRow[] = [];
  const seen = new Set<string>();

  const walk = (parentId: string | null, depth: number): void => {
    const kids = byParent.get(parentId) ?? [];
    for (const row of kids) {
      if (seen.has(row.id)) continue; // guard against pathological cycles
      seen.add(row.id);
      out.push({ row, depth });
      if (row.kind === 'group' && !row.collapsed) walk(row.id, depth + 1);
    }
  };
  walk(null, 0);

  // Rows not visited are either intentionally hidden under a collapsed group (leave them
  // hidden) or genuinely orphaned by a broken parent chain (surface at top level so they
  // aren't lost). Distinguish by whether the parent chain cleanly reaches the root.
  const byId = new Map(rows.map((r) => [r.id, r]));
  const isOrphan = (start: Row): boolean => {
    let cur: Row | undefined = start;
    let guard = 0;
    while (cur && cur.parentId != null) {
      const parent = byId.get(cur.parentId);
      if (!parent || guard++ > rows.length) return true; // missing link or cycle
      cur = parent;
    }
    return false; // reached root cleanly → hidden under a collapsed ancestor, not an orphan
  };
  for (const row of rows) {
    if (!seen.has(row.id) && isOrphan(row)) {
      seen.add(row.id);
      out.push({ row, depth: 0 });
    }
  }
  return out;
}

/** True if `nodeId` lies within `ancestorId`'s subtree (ancestorId is an ancestor of it). */
export function isDescendant(rows: Row[], ancestorId: string, nodeId: string): boolean {
  const byId = new Map(rows.map((r) => [r.id, r]));
  let cur = byId.get(nodeId);
  let guard = 0;
  while (cur && cur.parentId != null && guard++ <= rows.length) {
    if (cur.parentId === ancestorId) return true;
    cur = byId.get(cur.parentId);
  }
  return false;
}

/** A group's id plus all of its descendants' ids. */
export function subtreeIds(rows: Row[], groupId: string): Set<string> {
  const byParent = childrenByParent(rows);
  const ids = new Set<string>([groupId]);
  const stack = [groupId];
  while (stack.length) {
    const parent = stack.pop()!;
    for (const child of byParent.get(parent) ?? []) {
      if (!ids.has(child.id)) {
        ids.add(child.id);
        stack.push(child.id);
      }
    }
  }
  return ids;
}

/**
 * Re-enforce all tree invariants, returning a NEW array of NEW row objects:
 *  - the single track row → parentId=null, order 0; section → parentId=null, order 1
 *  - a non-null parentId must reference an existing `group` row, else it's reset to null
 *  - cycles are broken (any node whose ancestor chain never reaches null → parentId=null)
 *  - within each parent bucket, `order` is reassigned sequentially (top-level non-fixed
 *    rows start at 2; nested children start at 0)
 */
export function normalizeTree(rows: Row[]): Row[] {
  // 1) clone + fix parentId validity (track/section pinned to top; bad/non-group → null).
  const groupIds = new Set(rows.filter((r) => r.kind === 'group').map((r) => r.id));
  const fixed: Row[] = rows.map((r) => {
    if (r.kind === 'track' || r.kind === 'section') return { ...r, parentId: null };
    const parentId = r.parentId != null && groupIds.has(r.parentId) ? r.parentId : null;
    return { ...r, parentId };
  });

  // 2) break cycles: if walking up never reaches null within N steps, detach to top level.
  const byId = new Map(fixed.map((r) => [r.id, r]));
  for (const r of fixed) {
    let cur: Row | undefined = r;
    let guard = 0;
    while (cur && cur.parentId != null) {
      if (guard++ > fixed.length) {
        r.parentId = null; // safe: these are freshly-cloned objects
        break;
      }
      cur = byId.get(cur.parentId);
    }
  }

  // 3) reassign sequential sibling order per parent bucket.
  const byParent = new Map<string | null, Row[]>();
  for (const r of fixed) {
    const key = r.parentId ?? null;
    let list = byParent.get(key);
    if (!list) {
      list = [];
      byParent.set(key, list);
    }
    list.push(r);
  }
  for (const [parentId, list] of byParent) {
    if (parentId === null) {
      const track = list.filter((r) => r.kind === 'track');
      const section = list.filter((r) => r.kind === 'section');
      const rest = list
        .filter((r) => r.kind !== 'track' && r.kind !== 'section')
        .sort((a, b) => a.order - b.order);
      track.forEach((r) => (r.order = 0));
      section.forEach((r) => (r.order = 1));
      rest.forEach((r, i) => (r.order = i + 2));
    } else {
      list.sort((a, b) => a.order - b.order).forEach((r, i) => (r.order = i));
    }
  }

  return fixed;
}

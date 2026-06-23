import { describe, it, expect, beforeEach } from 'vitest';
import {
  useStore,
  undo,
  redo,
  beginHistoryGroup,
  endHistoryGroup,
  clearHistory,
  applyRemoteCoreNoHistory,
  temporalStore,
} from './store';

const s = () => useStore.getState();
function rowsByKind(kind: string) {
  return s().core.rows.filter((r) => r.kind === kind);
}

beforeEach(() => {
  s().newProject('Test');
  clearHistory();
});

describe('fresh project invariants (spec §4)', () => {
  it('has exactly one track and one section row at orders 0 and 1', () => {
    expect(rowsByKind('track')).toHaveLength(1);
    expect(rowsByKind('section')).toHaveLength(1);
    expect(rowsByKind('track')[0].order).toBe(0);
    expect(rowsByKind('section')[0].order).toBe(1);
  });
  it('cue rows have unique orders >= 2', () => {
    s().addCueRow();
    const cues = rowsByKind('cue');
    const orders = cues.map((r) => r.order);
    expect(Math.min(...orders)).toBeGreaterThanOrEqual(2);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe('rows', () => {
  it('refuses to remove fixed rows but removes cue rows + their blocks', () => {
    const track = rowsByKind('track')[0];
    s().removeRow(track.id);
    expect(rowsByKind('track')).toHaveLength(1); // unchanged

    const cue = rowsByKind('cue')[0];
    s().addBlock(cue.id, 1, 2);
    expect(s().core.blocks).toHaveLength(1);
    s().removeRow(cue.id);
    expect(s().core.rows.find((r) => r.id === cue.id)).toBeUndefined();
    expect(s().core.blocks).toHaveLength(0); // blocks deleted with the row
  });

  it('keeps track=0/section=1 pinned when reordering cue rows', () => {
    const a = s().addCueRow();
    const b = s().addCueRow();
    s().reorderCueRows([b, a]);
    expect(rowsByKind('track')[0].order).toBe(0);
    expect(rowsByKind('section')[0].order).toBe(1);
    const rowB = s().core.rows.find((r) => r.id === b)!;
    const rowA = s().core.rows.find((r) => r.id === a)!;
    expect(rowB.order).toBeLessThan(rowA.order);
  });
});

describe('blocks', () => {
  it('addBlock normalizes order and selects the new block', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addBlock(cue.id, 5, 2); // reversed
    const b = s().core.blocks.find((x) => x.id === id)!;
    expect(b.start).toBe(2);
    expect(b.end).toBe(5);
    expect(b.isPoint).toBe(false);
    expect(s().selection).toEqual([id]);
  });

  it('addPointCue creates a zero-length point (end === start, isPoint)', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addPointCue(cue.id, 3);
    const b = s().core.blocks.find((x) => x.id === id)!;
    expect(b.isPoint).toBe(true);
    expect(b.start).toBe(b.end);
  });

  it('moveBlock preserves duration and clamps to >= 0', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addBlock(cue.id, 4, 6);
    s().moveBlock(id, -10);
    const b = s().core.blocks.find((x) => x.id === id)!;
    expect(b.start).toBe(0);
    expect(b.end).toBe(2); // duration 2 preserved
  });

  it('resizing a point cue past zero converts it to ranged', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addPointCue(cue.id, 2);
    s().resizeBlock(id, 'end', 4);
    const b = s().core.blocks.find((x) => x.id === id)!;
    expect(b.isPoint).toBe(false);
    expect(b.end).toBe(4);
  });

  it('resizing a ranged cue to zero duration converts it to a milestone', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addBlock(cue.id, 4, 6);
    s().resizeBlock(id, 'end', 4); // drag the end back to the start
    const b = s().core.blocks.find((x) => x.id === id)!;
    expect(b.isPoint).toBe(true);
    expect(b.start).toBe(b.end);
  });

  it('moveBlock can move a cue to another cue/section row, but not a track/group', () => {
    const a = rowsByKind('cue')[0].id;
    const other = s().addCueRow();
    const id = s().addBlock(a, 1, 2);
    s().moveBlock(id, 1, other);
    expect(s().core.blocks.find((x) => x.id === id)!.rowId).toBe(other);
    // a track row is not a block lane → rejected (stays on `other`)
    s().moveBlock(id, 1, rowsByKind('track')[0].id);
    expect(s().core.blocks.find((x) => x.id === id)!.rowId).toBe(other);
    // the section row is a block lane → allowed
    const section = rowsByKind('section')[0].id;
    s().moveBlock(id, 1, section);
    expect(s().core.blocks.find((x) => x.id === id)!.rowId).toBe(section);
  });

  it('resnapAllToGrid pulls blocks onto the grid', () => {
    const cue = rowsByKind('cue')[0];
    // grid: 120bpm, 4/4, offset 0 → bar = 2s. snap=bar by default.
    const id = s().addBlock(cue.id, 1.1, 3.4);
    s().resnapAllToGrid();
    const b = s().core.blocks.find((x) => x.id === id)!;
    expect(b.start).toBeCloseTo(2, 6); // nearest bar to 1.1
    expect(b.end).toBeCloseTo(4, 6); // nearest bar to 3.4
  });
});

describe('cue curves', () => {
  it('setCueMode seeds an ascending curve and preserves the label', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addBlock(cue.id, 1, 3, 'Build up');
    s().setCueMode(id, 'curve');
    const b = s().core.blocks.find((x) => x.id === id)!;
    expect(b.mode).toBe('curve');
    expect(b.curve?.type).toBe('ascending');
    expect(b.curve?.points).toHaveLength(2);
    expect(b.label).toBe('Build up'); // label kept, just hidden in curve mode
  });

  it('switching a point cue to curve expands it to a ranged span', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addPointCue(cue.id, 2);
    s().setCueMode(id, 'curve');
    const b = s().core.blocks.find((x) => x.id === id)!;
    expect(b.isPoint).toBe(false);
    expect(b.end).toBeGreaterThan(b.start);
  });

  it('curve→text→curve preserves both the label and the edited points', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addBlock(cue.id, 1, 3, 'Keep me');
    s().setCueMode(id, 'curve');
    s().setCurveType(id, 'arbitrary');
    s().addCurvePoint(id, 0.5, 0.9);
    const edited = s().core.blocks.find((x) => x.id === id)!.curve!.points.length;
    expect(edited).toBe(3);

    s().setCueMode(id, 'text');
    const t = s().core.blocks.find((x) => x.id === id)!;
    expect(t.mode).toBe('text');
    expect(t.curve?.points).toHaveLength(3); // curve retained while in text mode

    s().setCueMode(id, 'curve');
    const c = s().core.blocks.find((x) => x.id === id)!;
    expect(c.curve?.type).toBe('arbitrary');
    expect(c.curve?.points).toHaveLength(3);
    expect(c.label).toBe('Keep me');
  });

  it('setCurveType resets points to the type default', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addBlock(cue.id, 0, 4);
    s().setCueMode(id, 'curve');
    s().setCurveType(id, 'peak');
    const b = s().core.blocks.find((x) => x.id === id)!;
    expect(b.curve?.type).toBe('peak');
    expect(b.curve?.points).toHaveLength(3); // ascending(2) → peak(3)
  });

  it('endpoint t stays pinned and values clamp when moving points', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addBlock(cue.id, 0, 4);
    s().setCueMode(id, 'curve');
    s().moveCurvePoint(id, 0, 0.7, 5); // try to move the first point's time and overshoot value
    const p = s().core.blocks.find((x) => x.id === id)!.curve!.points;
    expect(p[0].t).toBe(0); // endpoint time locked
    expect(p[0].v).toBe(1); // value clamped to 1
  });

  it('groups a point drag into a single undo step', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addBlock(cue.id, 0, 4);
    s().setCueMode(id, 'curve');
    s().setCurveType(id, 'peak');
    clearHistory();

    beginHistoryGroup('Move curve point');
    s().moveCurvePoint(id, 1, 0.4, 0.8);
    s().moveCurvePoint(id, 1, 0.6, 0.9);
    s().moveCurvePoint(id, 1, 0.55, 0.95);
    endHistoryGroup();

    const moved = s().core.blocks.find((x) => x.id === id)!.curve!.points[1];
    expect(moved.t).toBeCloseTo(0.55, 6);
    undo(); // one undo reverts the whole drag back to the peak default (mid at 0.5)
    const reverted = s().core.blocks.find((x) => x.id === id)!.curve!.points[1];
    expect(reverted.t).toBeCloseTo(0.5, 6);
  });
});

describe('grid edits leave blocks at stored seconds (spec §5.2)', () => {
  it('changing BPM does not move existing block times', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addBlock(cue.id, 3, 7);
    s().setBpm(90);
    const b = s().core.blocks.find((x) => x.id === id)!;
    expect(b.start).toBe(3);
    expect(b.end).toBe(7);
  });
});

describe('undo / redo (zundo)', () => {
  it('undoes and redoes a block add', () => {
    const cue = rowsByKind('cue')[0];
    expect(s().core.blocks).toHaveLength(0);
    s().addBlock(cue.id, 1, 2);
    expect(s().core.blocks).toHaveLength(1);
    undo();
    expect(s().core.blocks).toHaveLength(0);
    redo();
    expect(s().core.blocks).toHaveLength(1);
  });

  it('groups a gesture into a single undo step', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addBlock(cue.id, 4, 6);
    beginHistoryGroup('Move block');
    s().moveBlock(id, 5);
    s().moveBlock(id, 6);
    s().moveBlock(id, 7); // three live moves within one gesture
    endHistoryGroup();
    expect(s().core.blocks.find((x) => x.id === id)!.start).toBe(7);
    undo(); // one undo reverts the whole gesture back to start 4
    expect(s().core.blocks.find((x) => x.id === id)!.start).toBe(4);
  });

  it('stamps a descriptive label on the live state for each edit', () => {
    const cue = rowsByKind('cue')[0];
    s().setBpm(128);
    expect(s().historyLabel).toBe('Set BPM 128');
    s().addBlock(cue.id, 1, 2);
    expect(s().historyLabel).toBe('Add block');
  });

  it('carries the label with each history snapshot and through undo/redo', () => {
    const cue = rowsByKind('cue')[0];
    s().setBpm(140); // current label "Set BPM 140"
    s().addBlock(cue.id, 1, 2); // current label "Add block"; "Set BPM 140" now in the past

    const past = temporalStore.getState().pastStates;
    expect(past[past.length - 1].historyLabel).toBe('Set BPM 140');

    undo(); // back to the post-setBpm state → live label is its own
    expect(s().historyLabel).toBe('Set BPM 140');
    expect(temporalStore.getState().futureStates[0].historyLabel).toBe('Add block');

    redo();
    expect(s().historyLabel).toBe('Add block');
  });

  it('labels a grouped gesture as a single self-describing entry', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addBlock(cue.id, 4, 6); // live label "Add block"
    beginHistoryGroup('Move block');
    s().moveBlock(id, 7);
    endHistoryGroup();
    expect(s().historyLabel).toBe('Move block');
    // The snapshot pushed at gesture start keeps the pre-gesture label.
    const past = temporalStore.getState().pastStates;
    expect(past[past.length - 1].historyLabel).toBe('Add block');
    undo();
    expect(s().historyLabel).toBe('Add block');
  });

  it('does not track view changes (zoom/scroll/snap) in history', () => {
    const cue = rowsByKind('cue')[0];
    s().addBlock(cue.id, 1, 2);
    s().setSnap({ grid: 'eighth' });
    s().setScrollSec(5);
    undo(); // should revert the block add, not the view changes
    expect(s().core.blocks).toHaveLength(0);
    expect(s().view.snap.grid).toBe('eighth');
    expect(s().view.scrollSec).toBe(5);
  });
});

describe('row groups (folders)', () => {
  const rowById = (id: string) => s().core.rows.find((r) => r.id === id)!;

  it('addGroup creates a top-level group with order >= 2', () => {
    const g = s().addGroup();
    expect(rowById(g).kind).toBe('group');
    expect(rowById(g).parentId).toBeNull();
    expect(rowById(g).order).toBeGreaterThanOrEqual(2);
  });

  it('setParent moves a cue into a group; rejects moving fixed rows', () => {
    const g = s().addGroup();
    const cue = rowsByKind('cue')[0].id;
    s().setParent(cue, g);
    expect(rowById(cue).parentId).toBe(g);

    const track = rowsByKind('track')[0].id;
    s().setParent(track, g);
    expect(rowById(track).parentId).toBeNull(); // fixed rows can't be nested
  });

  it('setParent rejects creating a cycle (group into its own descendant)', () => {
    const outer = s().addGroup();
    const inner = s().addGroup();
    s().setParent(inner, outer); // inner now child of outer
    s().setParent(outer, inner); // would create a cycle → rejected
    expect(rowById(outer).parentId).toBeNull();
    expect(rowById(inner).parentId).toBe(outer);
  });

  it('moveRow only reorders within the same parent', () => {
    const g = s().addGroup();
    const c1 = s().addCueRow(g);
    const c2 = s().addCueRow(g);
    expect(rowById(c1).order).toBeLessThan(rowById(c2).order);
    s().moveRow(c2, -1);
    expect(rowById(c2).order).toBeLessThan(rowById(c1).order);
    expect(rowById(c1).parentId).toBe(g);
    expect(rowById(c2).parentId).toBe(g);
  });

  it('toggleCollapse flips the group collapsed flag', () => {
    const g = s().addGroup();
    expect(rowById(g).collapsed).toBe(false);
    s().toggleCollapse(g);
    expect(rowById(g).collapsed).toBe(true);
  });

  it('removeGroup delete removes the subtree + its blocks + prunes selection', () => {
    const g = s().addGroup();
    const cue = s().addCueRow(g);
    const blockId = s().addBlock(cue, 1, 2); // selects it
    expect(s().selection).toContain(blockId);
    s().removeGroup(g, 'delete');
    expect(s().core.rows.find((r) => r.id === g)).toBeUndefined();
    expect(s().core.rows.find((r) => r.id === cue)).toBeUndefined();
    expect(s().core.blocks.find((b) => b.id === blockId)).toBeUndefined();
    expect(s().selection).not.toContain(blockId);
  });

  it('removeGroup ungroup promotes children and keeps their blocks', () => {
    const g = s().addGroup();
    const cue = s().addCueRow(g);
    const blockId = s().addBlock(cue, 1, 2);
    s().removeGroup(g, 'ungroup');
    expect(s().core.rows.find((r) => r.id === g)).toBeUndefined();
    expect(rowById(cue).parentId).toBeNull(); // promoted to top level
    expect(s().core.blocks.find((b) => b.id === blockId)).toBeTruthy();
  });

  it('reordering a group at top level keeps its children attached', () => {
    const g = s().addGroup();
    const child = s().addCueRow(g);
    const sibling = s().addCueRow(); // top-level cue after the group
    s().reorderSiblings(null, [sibling, g]); // put sibling before the group
    expect(rowById(sibling).order).toBeLessThan(rowById(g).order);
    expect(rowById(child).parentId).toBe(g); // subtree intact
  });
});

describe('prep cue + column widths', () => {
  it('updateRow stores a prep cue on a row', () => {
    const cue = rowsByKind('cue')[0].id;
    s().updateRow(cue, { prepCue: 'House at 50%, haze on' });
    expect(s().core.rows.find((r) => r.id === cue)!.prepCue).toBe('House at 50%, haze on');
  });

  it('setPrepWidth clamps to the allowed range', () => {
    s().setPrepWidth(99999);
    expect(s().prepWidth).toBeLessThanOrEqual(440);
    s().setPrepWidth(1);
    expect(s().prepWidth).toBeGreaterThanOrEqual(110);
  });
});

describe('zoomToSelection', () => {
  it('frames the selected blocks in the lane width', () => {
    const cue = rowsByKind('cue')[0];
    s().setLaneWidth(1000);
    const id = s().addBlock(cue.id, 10, 20); // span 10s, selected by addBlock
    s().setSelection([id]);
    s().zoomToSelection();
    const v = s().view;
    // span 10s + 8% pad each side = 11.6s visible across 1000px → ~86 px/s
    expect(v.pixelsPerSecond).toBeGreaterThan(70);
    expect(v.pixelsPerSecond).toBeLessThan(100);
    // left edge sits a little before the block start
    expect(v.scrollSec).toBeGreaterThan(9);
    expect(v.scrollSec).toBeLessThan(10);
  });

  it('frames a zero-length point cue without infinite zoom', () => {
    const cue = rowsByKind('cue')[0];
    s().setLaneWidth(1000);
    const id = s().addPointCue(cue.id, 30);
    s().setSelection([id]);
    s().zoomToSelection();
    expect(Number.isFinite(s().view.pixelsPerSecond)).toBe(true);
    expect(s().view.pixelsPerSecond).toBeLessThanOrEqual(4000);
    expect(s().view.scrollSec).toBeLessThan(30); // centred-ish around the point
  });

  it('is a no-op with no selection', () => {
    const before = s().view;
    s().clearSelection();
    s().zoomToSelection();
    expect(s().view).toBe(before);
  });
});

describe('exportProject is pure', () => {
  it('does not mutate core when called (no autosave feedback loop)', () => {
    const before = s().core;
    const p = s().exportProject();
    expect(s().core).toBe(before); // same reference → no mutation
    expect(p.view).toEqual(s().view);
    expect(p.schemaVersion).toBe(1);
  });
});

describe('collaborative apply (applyRemoteCore)', () => {
  it('applies a remote core without adding to local undo history', () => {
    const cue = rowsByKind('cue')[0];
    s().addBlock(cue.id, 1, 2);
    clearHistory();
    expect(temporalStore.getState().pastStates).toHaveLength(0);

    const remoteBlock = { ...s().core.blocks[0], id: 'remote-block-1', start: 5, end: 6 };
    const remote = {
      ...s().core,
      blocks: [...s().core.blocks, remoteBlock],
      updatedAt: s().core.updatedAt + 1000,
    };
    applyRemoteCoreNoHistory(remote);

    expect(s().core.blocks).toHaveLength(2); // remote edit applied
    expect(temporalStore.getState().pastStates).toHaveLength(0); // but not undoable
  });

  it('leaves the local view untouched when applying a remote core', () => {
    s().setScrollSec(42);
    s().setPixelsPerSecond(123);
    const remote = { ...s().core, name: 'Renamed remotely', updatedAt: s().core.updatedAt + 1000 };
    applyRemoteCoreNoHistory(remote);

    expect(s().core.name).toBe('Renamed remotely');
    expect(s().view.scrollSec).toBe(42); // local view preserved
    expect(s().view.pixelsPerSecond).toBe(123);
  });

  it('prunes selection to blocks that still exist after a remote apply', () => {
    const cue = rowsByKind('cue')[0];
    const id = s().addBlock(cue.id, 1, 2); // addBlock selects it
    expect(s().selection).toEqual([id]);

    const remote = { ...s().core, blocks: [], updatedAt: s().core.updatedAt + 1000 };
    applyRemoteCoreNoHistory(remote);

    expect(s().selection).toEqual([]); // selected block is gone → dropped
  });

  it('does not let a remote apply resume undo tracking if it was paused', () => {
    // Mid-gesture (tracking paused), an inbound remote edit must not re-enable recording.
    beginHistoryGroup('Move block');
    expect(temporalStore.getState().isTracking).toBe(false);
    const remote = { ...s().core, name: 'During gesture', updatedAt: s().core.updatedAt + 1 };
    applyRemoteCoreNoHistory(remote);
    expect(temporalStore.getState().isTracking).toBe(false); // still paused
    endHistoryGroup();
    expect(temporalStore.getState().isTracking).toBe(true);
  });
});

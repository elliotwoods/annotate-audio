import { describe, it, expect, beforeEach } from 'vitest';
import { useStore, undo, redo, beginHistoryGroup, endHistoryGroup, clearHistory } from './store';

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
    beginHistoryGroup();
    s().moveBlock(id, 5);
    s().moveBlock(id, 6);
    s().moveBlock(id, 7); // three live moves within one gesture
    endHistoryGroup();
    expect(s().core.blocks.find((x) => x.id === id)!.start).toBe(7);
    undo(); // one undo reverts the whole gesture back to start 4
    expect(s().core.blocks.find((x) => x.id === id)!.start).toBe(4);
  });

  it('does not track view changes (zoom/scroll/snap) in history', () => {
    const cue = rowsByKind('cue')[0];
    s().addBlock(cue.id, 1, 2);
    s().setSnap('eighth');
    s().setScrollSec(5);
    undo(); // should revert the block add, not the view changes
    expect(s().core.blocks).toHaveLength(0);
    expect(s().view.snap).toBe('eighth');
    expect(s().view.scrollSec).toBe(5);
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

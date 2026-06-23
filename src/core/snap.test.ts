import { describe, it, expect } from 'vitest';
import {
  cueEdgeTimes,
  snapMoveStart,
  snapTimeWith,
  SNAP_PX,
  type SnapContext,
} from './snap';
import type { BeatGrid, Block, SnapSettings } from '../model/types';

// 120 bpm, 4/4: beat = 0.5s, bar = 2s. Offset 0 so bar lines fall on 0, 2, 4, …
const grid: BeatGrid = { bpm: 120, offset: 0, beatsPerBar: 4, beatUnit: 4 };

const settings = (over: Partial<SnapSettings> = {}): SnapSettings => ({
  enabled: true,
  cues: false,
  grid: null,
  ...over,
});

const ctx = (over: Partial<SnapContext> = {}): SnapContext => ({
  grid,
  snap: settings(),
  pixelsPerSecond: 100, // 8px magnet ⇒ 0.08s tolerance
  cueTimes: [],
  ...over,
});

const block = (id: string, start: number, end: number, isPoint = false): Block => ({
  id,
  rowId: 'r',
  start,
  end: isPoint ? start : end,
  isPoint,
  label: '',
});

describe('snapTimeWith', () => {
  it('returns t unchanged with a null guide when the master toggle is off', () => {
    const r = snapTimeWith(1.234, ctx({ snap: settings({ enabled: false, grid: 'bar' }) }));
    expect(r).toEqual({ value: 1.234, guide: null });
  });

  it('returns t unchanged when nothing is enabled', () => {
    expect(snapTimeWith(1.234, ctx())).toEqual({ value: 1.234, guide: null });
  });

  it('quantises to the selected grid division and reports a grid guide', () => {
    // bar = 2s; 1.2 → 2
    const r = snapTimeWith(1.2, ctx({ snap: settings({ grid: 'bar' }) }));
    expect(r.value).toBeCloseTo(2);
    expect(r.guide).toEqual({ time: r.value, kind: 'grid' });
    // quarter = beat = 0.5s; 0.62 → 0.5
    expect(snapTimeWith(0.62, ctx({ snap: settings({ grid: 'quarter' }) })).value).toBeCloseTo(0.5);
  });

  it('snaps to a nearby cue edge within the magnet radius and reports a cue guide', () => {
    const c = ctx({ snap: settings({ cues: true }), cueTimes: [5.0] });
    // 0.08s tolerance at 100px/s: 5.05 is within, 5.2 is not.
    expect(snapTimeWith(5.05, c)).toEqual({ value: 5.0, guide: { time: 5.0, kind: 'cue' } });
    expect(snapTimeWith(5.2, c)).toEqual({ value: 5.2, guide: null });
  });

  it('lets a cue magnet override the grid when both are on and a cue is in range', () => {
    const c = ctx({ snap: settings({ cues: true, grid: 'bar' }), cueTimes: [5.0] });
    expect(snapTimeWith(5.03, c)).toEqual({ value: 5.0, guide: { time: 5.0, kind: 'cue' } });
  });

  it('falls back to the grid when no cue is in range', () => {
    const c = ctx({ snap: settings({ cues: true, grid: 'bar' }), cueTimes: [5.0] });
    const r = snapTimeWith(1.1, c);
    expect(r.value).toBeCloseTo(2); // nearest bar line
    expect(r.guide?.kind).toBe('grid');
  });

  it('scales the magnet radius with zoom', () => {
    // At 10px/s the tolerance is 0.8s, so 5.5 catches a cue at 5.0.
    const c = ctx({ snap: settings({ cues: true }), pixelsPerSecond: 10, cueTimes: [5.0] });
    expect(snapTimeWith(5.5, c).value).toBe(5.0);
    expect(SNAP_PX / 10).toBeCloseTo(0.8);
  });
});

describe('snapMoveStart', () => {
  it('aligns the start edge to a cue', () => {
    const c = ctx({ snap: settings({ cues: true }), cueTimes: [10.0] });
    expect(snapMoveStart(10.04, 3, c)).toEqual({ value: 10.0, guide: { time: 10.0, kind: 'cue' } });
  });

  it('aligns the end edge to a cue (preserving duration), guiding at the end', () => {
    // dur 3, end ≈ 10 lands a cue ⇒ start becomes 7, guide drawn at the end (10).
    const c = ctx({ snap: settings({ cues: true }), cueTimes: [10.0] });
    const r = snapMoveStart(7.03, 3, c);
    expect(r.value).toBeCloseTo(7.0);
    expect(r.guide).toEqual({ time: 10.0, kind: 'cue' });
  });

  it('prefers whichever edge is closer to a cue', () => {
    const c = ctx({ snap: settings({ cues: true }), cueTimes: [0, 5] });
    // start 0.06 from cue 0, end (start+5)=5.02 ⇒ 0.02 from cue 5: end wins ⇒ start = 0.
    expect(snapMoveStart(0.06, 5, c).value).toBeCloseTo(0.0);
  });

  it('falls back to grid-quantising the start', () => {
    const c = ctx({ snap: settings({ grid: 'bar' }), cueTimes: [] });
    const r = snapMoveStart(1.2, 1, c);
    expect(r.value).toBeCloseTo(2);
    expect(r.guide?.kind).toBe('grid');
  });

  it('does not snap when disabled', () => {
    const c = ctx({ snap: settings({ enabled: false, cues: true }), cueTimes: [10] });
    expect(snapMoveStart(10.01, 3, c)).toEqual({ value: 10.01, guide: null });
  });
});

describe('cueEdgeTimes', () => {
  it('collects start and end of ranged cues and excludes the dragged block', () => {
    const blocks = [block('a', 1, 3), block('b', 5, 5, true), block('c', 8, 10)];
    expect(cueEdgeTimes(blocks, 'a').sort((x, y) => x - y)).toEqual([5, 8, 10]);
  });

  it('emits a single time for point cues', () => {
    expect(cueEdgeTimes([block('p', 4, 4, true)])).toEqual([4]);
  });
});

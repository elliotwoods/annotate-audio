import { describe, it, expect } from 'vitest';
import type { CurvePoint } from '../model/types';
import {
  clamp01,
  easeShape,
  evalCurve,
  defaultPointsFor,
  addCurvePoint,
  moveCurvePoint,
  deleteCurvePoint,
  setPointShape,
  sampleCurve,
  normalizePoints,
  heldValueAt,
  type HeldCue,
} from './curve';

const pts = (...ps: Array<[number, number, CurvePoint['shape']?]>): CurvePoint[] =>
  ps.map(([t, v, shape]) => ({ t, v, shape: shape ?? 'linear' }));

describe('clamp01', () => {
  it('clamps to [0,1] and coerces non-finite to 0', () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.3)).toBe(0.3);
    expect(clamp01(NaN)).toBe(0);
  });
});

describe('easeShape', () => {
  it('maps endpoints 0->0 and 1->1 for every shape', () => {
    for (const shape of ['linear', 'exp', 'log', 'scurve', 'step'] as const) {
      expect(easeShape(shape, 0)).toBeCloseTo(0, 9);
      expect(easeShape(shape, 1)).toBeCloseTo(1, 9);
    }
  });

  it('has the expected midpoint behaviour', () => {
    expect(easeShape('linear', 0.5)).toBeCloseTo(0.5, 9);
    expect(easeShape('exp', 0.5)).toBeCloseTo(0.25, 9);
    expect(easeShape('log', 0.5)).toBeCloseTo(Math.sqrt(0.5), 9);
    expect(easeShape('scurve', 0.5)).toBeCloseTo(0.5, 9);
    expect(easeShape('step', 0.49)).toBe(0); // holds until the midpoint
    expect(easeShape('step', 0.5)).toBe(1); // jumps at the midpoint
  });
});

describe('evalCurve', () => {
  it('returns endpoints exactly and clamps outside [0,1]', () => {
    const p = pts([0, 0], [1, 1]);
    expect(evalCurve(p, 0)).toBeCloseTo(0, 9);
    expect(evalCurve(p, 1)).toBeCloseTo(1, 9);
    expect(evalCurve(p, -1)).toBeCloseTo(0, 9);
    expect(evalCurve(p, 2)).toBeCloseTo(1, 9);
  });

  it('ascending linear at x=0.5 is 0.5', () => {
    expect(evalCurve(pts([0, 0], [1, 1]), 0.5)).toBeCloseTo(0.5, 9);
  });

  it('descending linear at x=0.5 is 0.5', () => {
    expect(evalCurve(pts([0, 1], [1, 0]), 0.5)).toBeCloseTo(0.5, 9);
  });

  it('peak at x=0.5 reaches the top', () => {
    expect(evalCurve(defaultPointsFor('peak'), 0.5)).toBeCloseTo(1, 9);
  });

  it('applies the segment shape of the LEFT point', () => {
    // exp leaving point 0: at x=0.5 progress 0.5 -> eased 0.25 -> v 0.25
    expect(evalCurve(pts([0, 0, 'exp'], [1, 1]), 0.5)).toBeCloseTo(0.25, 9);
    // log leaving point 0: at x=0.5 -> sqrt(0.5)
    expect(evalCurve(pts([0, 0, 'log'], [1, 1]), 0.5)).toBeCloseTo(Math.sqrt(0.5), 9);
  });

  it('step holds then jumps at the midpoint', () => {
    const p = pts([0, 0.2, 'step'], [1, 0.8]);
    expect(evalCurve(p, 0.4)).toBeCloseTo(0.2, 9); // before the midpoint
    expect(evalCurve(p, 0.6)).toBeCloseTo(0.8, 9); // after the midpoint
    expect(evalCurve(p, 1)).toBeCloseTo(0.8, 9);
  });
});

describe('defaultPointsFor', () => {
  it('produces valid invariants for every type', () => {
    for (const type of ['ascending', 'descending', 'peak', 'trapezium', 'arbitrary'] as const) {
      const p = defaultPointsFor(type);
      expect(p.length).toBeGreaterThanOrEqual(2);
      expect(p[0].t).toBe(0);
      expect(p[p.length - 1].t).toBe(1);
      // monotonic t
      for (let i = 1; i < p.length; i++) expect(p[i].t).toBeGreaterThanOrEqual(p[i - 1].t);
    }
  });

  it('trapezium is a flat-topped attack/sustain/release shape', () => {
    const p = defaultPointsFor('trapezium');
    expect(p).toHaveLength(4);
    expect(p[0].v).toBe(0); // starts low
    expect(p[3].v).toBe(0); // ends low
    expect(p[1].v).toBe(1); // shoulders at the top
    expect(p[2].v).toBe(1);
    expect(evalCurve(p, 0.5)).toBeCloseTo(1, 9); // flat across the sustain
  });
});

describe('addCurvePoint', () => {
  it('inserts ordered and clamps into range', () => {
    const p = addCurvePoint(pts([0, 0], [1, 1]), 0.5, 1.5);
    expect(p).toHaveLength(3);
    expect(p[1]).toMatchObject({ t: 0.5, v: 1 });
    expect(p.map((x) => x.t)).toEqual([0, 0.5, 1]);
  });

  it('does not duplicate an endpoint t', () => {
    expect(addCurvePoint(pts([0, 0], [1, 1]), 0, 0.5)).toHaveLength(2);
    expect(addCurvePoint(pts([0, 0], [1, 1]), 1, 0.5)).toHaveLength(2);
  });

  it('inherits the split segment shape', () => {
    const p = addCurvePoint(pts([0, 0, 'exp'], [1, 1]), 0.5, 0.5);
    expect(p[1].shape).toBe('exp');
  });
});

describe('moveCurvePoint', () => {
  it('clamps v to [0,1]', () => {
    const p = moveCurvePoint(pts([0, 0], [0.5, 0.5], [1, 1]), 1, 0.5, 2);
    expect(p[1].v).toBe(1);
  });

  it('locks endpoint t at 0/1 but lets v move', () => {
    const p = moveCurvePoint(pts([0, 0], [1, 1]), 0, 0.4, 0.7);
    expect(p[0]).toMatchObject({ t: 0, v: 0.7 });
    const q = moveCurvePoint(pts([0, 0], [1, 1]), 1, 0.4, 0.2);
    expect(q[1]).toMatchObject({ t: 1, v: 0.2 });
  });

  it('clamps interior t strictly between neighbours', () => {
    const p = moveCurvePoint(pts([0, 0], [0.5, 0.5], [1, 1]), 1, 5, 0.5);
    expect(p[1].t).toBeLessThan(1);
    expect(p[1].t).toBeGreaterThan(0);
  });
});

describe('deleteCurvePoint', () => {
  it('removes interior points', () => {
    const p = deleteCurvePoint(pts([0, 0], [0.5, 0.5], [1, 1]), 1);
    expect(p).toHaveLength(2);
  });

  it('protects endpoints', () => {
    expect(deleteCurvePoint(pts([0, 0], [1, 1]), 0)).toHaveLength(2);
    expect(deleteCurvePoint(pts([0, 0], [1, 1]), 1)).toHaveLength(2);
  });
});

describe('setPointShape', () => {
  it('sets an interior/first point shape', () => {
    const p = setPointShape(pts([0, 0], [1, 1]), 0, 'scurve');
    expect(p[0].shape).toBe('scurve');
  });

  it('is a no-op on the last point', () => {
    const p = setPointShape(pts([0, 0], [1, 1]), 1, 'scurve');
    expect(p[1].shape).toBe('linear');
  });
});

describe('sampleCurve', () => {
  it('starts and ends at the endpoints', () => {
    const s = sampleCurve(pts([0, 0], [1, 1]), 4);
    expect(s[0]).toEqual({ x: 0, y: 0 });
    expect(s[s.length - 1]).toEqual({ x: 1, y: 1 });
  });

  it('emits a centered hold-jump-hold corner for step segments', () => {
    const s = sampleCurve(pts([0, 0.2, 'step'], [1, 0.8]));
    // hold to the midpoint, vertical jump at x=0.5, then hold to x=1
    expect(s).toContainEqual({ x: 0.5, y: 0.2 });
    expect(s).toContainEqual({ x: 0.5, y: 0.8 });
    expect(s[s.length - 1]).toEqual({ x: 1, y: 0.8 });
  });
});

describe('heldValueAt', () => {
  // A fade up over [0,2] then a fade down over [5,7].
  const cues: HeldCue[] = [
    { start: 0, end: 2, points: pts([0, 0], [1, 1]) }, // ascending
    { start: 5, end: 7, points: pts([0, 1], [1, 0]) }, // descending
  ];

  it('sits at the first cue start value before it (here a rise from 0)', () => {
    expect(heldValueAt(cues, -1)).toBeCloseTo(0, 9);
  });

  it('stays high before a first cue that starts high (a fall)', () => {
    const fallFirst: HeldCue[] = [{ start: 5, end: 7, points: pts([0, 1], [1, 0]) }];
    expect(heldValueAt(fallFirst, 0)).toBeCloseTo(1, 9); // level with where the fall begins
    expect(heldValueAt(fallFirst, 6)).toBeCloseTo(0.5, 9); // mid-fall
    expect(heldValueAt(fallFirst, 100)).toBeCloseTo(0, 9); // stays low after
  });

  it('evaluates within a cue span', () => {
    expect(heldValueAt(cues, 1)).toBeCloseTo(0.5, 9); // halfway up the first fade
  });

  it('holds the previous cue end value in the gap', () => {
    expect(heldValueAt(cues, 3)).toBeCloseTo(1, 9); // held high until the fade down
    expect(heldValueAt(cues, 5)).toBeCloseTo(1, 9); // start of the fade down
  });

  it('holds the last cue end value afterwards', () => {
    expect(heldValueAt(cues, 100)).toBeCloseTo(0, 9); // faded back down, stays down
  });

  it('returns 0 for no cues', () => {
    expect(heldValueAt([], 5)).toBe(0);
  });
});

describe('normalizePoints', () => {
  it('sorts, clamps and pins endpoints', () => {
    const p = normalizePoints(pts([1, 2], [0.5, -1], [0, 0.5]));
    expect(p.map((x) => x.t)).toEqual([0, 0.5, 1]);
    expect(p[0].t).toBe(0);
    expect(p[2].t).toBe(1);
    expect(p[1].v).toBe(0); // clamped from -1
  });
});

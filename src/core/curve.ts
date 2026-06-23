// Pure curve-envelope math for cue curves (spec: text↔curve cues). No React.
//
// A curve is an ordered list of control points in NORMALIZED space: t in [0,1] along the
// cue's span and v in [0,1] for the abstract envelope value. Each point carries the easing
// SHAPE of the segment leaving it toward the next point (the last point's shape is inert).
//
// Everything here is pure and unit-tested (see curve.test.ts), mirroring core/snap.ts.

import type { CurveData, CurvePoint, CurveType, SegmentShape } from '../model/types';

export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

export function lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p;
}

/**
 * Apply a segment shape's easing to fractional progress `p` in [0,1].
 *  - linear: p
 *  - exp (ease-in, slow start): p²
 *  - log/sqrt (ease-out, fast start): √p
 *  - scurve (ease-in-out): smoothstep p²(3−2p)
 *  - step (square): hold the start value, jump to the end value at the segment MIDPOINT, so
 *    the step is clearly visible even on a single (2-point) segment like a Rise/Fall
 */
export function easeShape(shape: SegmentShape, p: number): number {
  const x = clamp01(p);
  switch (shape) {
    case 'exp':
      return x * x;
    case 'log':
      return Math.sqrt(x);
    case 'scurve':
      return x * x * (3 - 2 * x);
    case 'step':
      return x < 0.5 ? 0 : 1;
    case 'linear':
    default:
      return x;
  }
}

/**
 * Evaluate the envelope value (0..1) at normalized x in [0..1]. Finds the segment
 * [points[i], points[i+1]] containing x, computes local progress, and applies that
 * segment's leaving shape. Clamps x to [0,1]; before the first point returns first.v,
 * after the last returns last.v.
 */
export function evalCurve(points: CurvePoint[], x: number): number {
  if (points.length === 0) return 0;
  const xc = clamp01(x);
  if (xc <= points[0].t) return clamp01(points[0].v);
  const last = points[points.length - 1];
  if (xc >= last.t) return clamp01(last.v);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (xc >= a.t && xc <= b.t) {
      const span = b.t - a.t;
      const p = span <= 0 ? 1 : (xc - a.t) / span;
      return clamp01(lerp(a.v, b.v, easeShape(a.shape, p)));
    }
  }
  return clamp01(last.v);
}

/** Canonical starting points for a curve type. first.t=0, last.t=1, length>=2, ordered. */
export function defaultPointsFor(type: CurveType): CurvePoint[] {
  switch (type) {
    case 'descending':
      return [
        { t: 0, v: 1, shape: 'linear' },
        { t: 1, v: 0, shape: 'linear' },
      ];
    case 'peak':
      return [
        { t: 0, v: 0, shape: 'linear' },
        { t: 0.5, v: 1, shape: 'linear' }, // middle = movable inflection point
        { t: 1, v: 0, shape: 'linear' },
      ];
    case 'trapezium':
      // Attack/Sustain/Release: rise to the top, hold flat, fall back. The two inner
      // points are the movable shoulders (where the sustain starts and ends).
      return [
        { t: 0, v: 0, shape: 'linear' },
        { t: 0.3, v: 1, shape: 'linear' }, // attack end / sustain start
        { t: 0.7, v: 1, shape: 'linear' }, // sustain end / release start
        { t: 1, v: 0, shape: 'linear' },
      ];
    case 'arbitrary':
      return [
        { t: 0, v: 0.5, shape: 'linear' },
        { t: 1, v: 0.5, shape: 'linear' },
      ];
    case 'ascending':
    default:
      return [
        { t: 0, v: 0, shape: 'linear' },
        { t: 1, v: 1, shape: 'linear' },
      ];
  }
}

/** Re-sort by t, clamp every t/v to [0,1], and pin the first/last t to 0/1. */
export function normalizePoints(points: CurvePoint[]): CurvePoint[] {
  const out = points
    .map((p) => ({ t: clamp01(p.t), v: clamp01(p.v), shape: p.shape }))
    .sort((a, b) => a.t - b.t);
  if (out.length > 0) {
    out[0] = { ...out[0], t: 0 };
    out[out.length - 1] = { ...out[out.length - 1], t: 1 };
  }
  return out;
}

/**
 * Insert a point at (t,v), keeping the array ordered by t and clamped to [0,1]. The new
 * point inherits the shape of the segment it splits (so the curve is unchanged in shape
 * until dragged). Endpoints (t at 0/1) are never duplicated.
 */
export function addCurvePoint(points: CurvePoint[], t: number, v: number): CurvePoint[] {
  const tc = clamp01(t);
  const vc = clamp01(v);
  // Find the segment this t falls into; inherit its leaving shape.
  let shape: SegmentShape = 'linear';
  let insertAt = points.length;
  for (let i = 0; i < points.length; i++) {
    if (tc <= points[i].t) {
      insertAt = i;
      shape = i > 0 ? points[i - 1].shape : points[i].shape;
      break;
    }
    shape = points[i].shape;
  }
  // Don't duplicate an existing point's t (incl. the two endpoints).
  if (points.some((p) => p.t === tc)) return points;
  const next = points.slice();
  next.splice(insertAt, 0, { t: tc, v: vc, shape });
  return normalizePoints(next);
}

/**
 * Move point at index i to (t,v). Clamps v to [0,1]. Endpoints keep t locked at 0/1 (only
 * their v moves); interior points clamp t strictly between their neighbours. Used for the
 * 'peak' inflection (i=1) and any 'arbitrary' interior point.
 */
export function moveCurvePoint(points: CurvePoint[], i: number, t: number, v: number): CurvePoint[] {
  if (i < 0 || i >= points.length) return points;
  const next = points.slice();
  const vc = clamp01(v);
  const isFirst = i === 0;
  const isLast = i === points.length - 1;
  let tc: number;
  if (isFirst) tc = 0;
  else if (isLast) tc = 1;
  else {
    const EPS = 1e-4;
    const lo = points[i - 1].t + EPS;
    const hi = points[i + 1].t - EPS;
    tc = Math.min(Math.max(clamp01(t), lo), Math.max(lo, hi));
  }
  next[i] = { ...next[i], t: tc, v: vc };
  return next;
}

/** Delete interior point i. Endpoints (first/last) are protected and returned unchanged. */
export function deleteCurvePoint(points: CurvePoint[], i: number): CurvePoint[] {
  if (i <= 0 || i >= points.length - 1) return points;
  const next = points.slice();
  next.splice(i, 1);
  return next;
}

/** Set the leaving-segment shape of point i. No-op on the last point (its shape is inert). */
export function setPointShape(points: CurvePoint[], i: number, shape: SegmentShape): CurvePoint[] {
  if (i < 0 || i >= points.length - 1) return points;
  const next = points.slice();
  next[i] = { ...next[i], shape };
  return next;
}

/**
 * Sample the envelope into a polyline for rendering, in normalized space ({x,y} in [0,1],
 * y measured bottom-up like v). Each segment is sampled with `perSegment` intermediate
 * steps; 'step' segments emit the hold corner then the jump so the path stays crisp.
 */
export function sampleCurve(points: CurvePoint[], perSegment = 16): { x: number; y: number }[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ x: points[0].t, y: points[0].v }];
  const out: { x: number; y: number }[] = [{ x: points[0].t, y: points[0].v }];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a.shape === 'step') {
      // Hold at a.v to the segment midpoint, jump to b.v, then hold — a visible square step.
      const mid = (a.t + b.t) / 2;
      out.push({ x: mid, y: a.v });
      out.push({ x: mid, y: b.v });
      out.push({ x: b.t, y: b.v });
      continue;
    }
    for (let s = 1; s <= perSegment; s++) {
      const p = s / perSegment;
      const x = lerp(a.t, b.t, p);
      const y = clamp01(lerp(a.v, b.v, easeShape(a.shape, p)));
      out.push({ x, y });
    }
  }
  return out;
}

/** Build a fresh CurveData for a type (used when first switching to curve / changing type). */
export function makeCurve(type: CurveType): CurveData {
  return { type, points: defaultPointsFor(type) };
}

/** A curve cue reduced to what the held-value math needs (absolute span + its points). */
export interface HeldCue {
  start: number; // seconds
  end: number; // seconds
  points: CurvePoint[];
}

/**
 * The "held" envelope value (0..1) at absolute time `t` across a row's curve cues (sorted by
 * start). Within a cue's span it's the evaluated curve; after a cue and before the next it
 * HOLDS that cue's end value (e.g. a fade-up stays up until the next cue); BEFORE the first
 * cue it sits at that cue's START value, so the level line runs in level with where the first
 * cue begins (a "fall" stays high before it). This drives the "current level" line.
 */
export function heldValueAt(cues: HeldCue[], t: number): number {
  // Before anything happens, sit at where the first cue begins (0 if there are no cues).
  let held = cues.length > 0 ? evalCurve(cues[0].points, 0) : 0;
  for (const c of cues) {
    if (t < c.start) break;
    if (t <= c.end) {
      const span = c.end - c.start;
      const x = span > 0 ? (t - c.start) / span : 1;
      return evalCurve(c.points, x);
    }
    held = evalCurve(c.points, 1); // past this cue: hold its end value
  }
  return held;
}

// Interaction snapping (spec §12). Sits on top of the pure beat-grid math in grid.ts and
// adds two things the bare `snapTime` quantiser can't express:
//
//   1. A master on/off, an independent "snap to cues" toggle, and a single-select grid
//      division ({@link SnapSettings}).
//   2. "Snap to other cues" — a screen-space magnet that aligns a dragged edge to the
//      start/end of OTHER cues (so cues line up across tracks), with the grid as a
//      fallback when no cue is in range.
//
// Each result also reports WHAT was snapped to ({@link SnapGuide}) so the UI can draw a
// guide line at the target. Everything here is pure and unit-tested; the UI passes in the
// live view/grid/snap plus the candidate cue edge times gathered at gesture start.

import type { BeatGrid, Block, SnapSettings } from '../model/types';
import { snapTime } from './grid';

/** Magnet radius for cue snapping, in CSS pixels (converted to seconds via the zoom). */
export const SNAP_PX = 8;

export interface SnapContext {
  grid: BeatGrid;
  snap: SnapSettings;
  /** Current zoom — turns the pixel magnet radius into a time tolerance. */
  pixelsPerSecond: number;
  /** Candidate cue edge times (seconds) to snap to; see {@link cueEdgeTimes}. */
  cueTimes: number[];
}

/** What a snap landed on, for drawing a guide line at the target. */
export interface SnapGuide {
  /** Time (seconds) of the snap target — where the guide is drawn. */
  time: number;
  kind: 'cue' | 'grid';
}

export interface SnapResult {
  /** The value to apply: an edge time for resize/create, or the start time for a move. */
  value: number;
  /** The target that was snapped to, or null when nothing snapped. */
  guide: SnapGuide | null;
}

/** Nearest value in `xs` to `t` with its absolute distance. Empty input → [NaN, Infinity]. */
function nearest(xs: number[], t: number): [number, number] {
  let best = NaN;
  let bestD = Infinity;
  for (const x of xs) {
    const d = Math.abs(x - t);
    if (d < bestD) {
      bestD = d;
      best = x;
    }
  }
  return [best, bestD];
}

/** The cue magnet tolerance in seconds for the current zoom. */
function cueTolerance(pixelsPerSecond: number): number {
  return SNAP_PX / Math.max(1e-6, pixelsPerSecond);
}

/**
 * Snap a single time (used for resize edges and block-create endpoints). A nearby cue edge
 * wins within the screen-space magnet radius; otherwise the time quantises to the selected
 * grid division. Returns `t` with a null guide when snapping is disabled or nothing is in
 * range.
 */
export function snapTimeWith(t: number, ctx: SnapContext): SnapResult {
  const { snap } = ctx;
  if (!snap.enabled) return { value: t, guide: null };
  if (snap.cues && ctx.cueTimes.length) {
    const [c, d] = nearest(ctx.cueTimes, t);
    if (d <= cueTolerance(ctx.pixelsPerSecond)) return { value: c, guide: { time: c, kind: 'cue' } };
  }
  if (snap.grid) {
    const g = snapTime(t, ctx.grid, snap.grid);
    return { value: g, guide: { time: g, kind: 'grid' } };
  }
  return { value: t, guide: null };
}

/**
 * Snap a whole-block MOVE, returning the snapped start (duration preserved). EITHER edge can
 * catch a cue magnet — whichever edge is closest to a cue aligns to it — so a block can be
 * dragged so that its end lines up with another cue, not just its start. The guide marks
 * whichever edge actually landed. Falls back to grid-quantising the start.
 */
export function snapMoveStart(rawStart: number, dur: number, ctx: SnapContext): SnapResult {
  const { snap } = ctx;
  if (!snap.enabled) return { value: rawStart, guide: null };
  if (snap.cues && ctx.cueTimes.length) {
    const tol = cueTolerance(ctx.pixelsPerSecond);
    const [cs, ds] = nearest(ctx.cueTimes, rawStart);
    const [ce, de] = nearest(ctx.cueTimes, rawStart + dur);
    const startOk = ds <= tol;
    const endOk = de <= tol;
    if (startOk && (!endOk || ds <= de)) return { value: cs, guide: { time: cs, kind: 'cue' } };
    if (endOk) return { value: ce - dur, guide: { time: ce, kind: 'cue' } };
  }
  if (snap.grid) {
    const g = snapTime(rawStart, ctx.grid, snap.grid);
    return { value: g, guide: { time: g, kind: 'grid' } };
  }
  return { value: rawStart, guide: null };
}

/**
 * Edge times (start, and end for ranged cues) of every block except `excludeId` — the
 * targets a dragged cue can magnet to. The dragged block is excluded so it can't snap to
 * itself.
 */
export function cueEdgeTimes(blocks: Block[], excludeId?: string): number[] {
  const out: number[] = [];
  for (const b of blocks) {
    if (b.id === excludeId) continue;
    out.push(b.start);
    if (!b.isPoint && b.end !== b.start) out.push(b.end);
  }
  return out;
}

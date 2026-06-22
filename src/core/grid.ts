// Constant-BPM beat-grid math (spec §6). No audio dependency, fully unit-testable.
//
// Deliberate decisions (do NOT "fix" these — spec §5.2 / §6):
//   - barLen = beatLen * beatsPerBar, with beatLen = 60 / bpm. `beatUnit` is stored
//     for display / future use but does not enter the bar-length formula.
//   - bar index 0 == the first downbeat (the grid offset). Negative indices before
//     the offset are allowed; display is 1-indexed (bar index 0 -> "1.1").

import type { BeatGrid, SnapResolution } from '../model/types';

const EPS = 1e-9;

/** Seconds per beat. */
export const beatLen = (g: BeatGrid): number => 60 / g.bpm;

/** Seconds per bar. */
export const barLen = (g: BeatGrid): number => beatLen(g) * g.beatsPerBar;

/** Is the grid usable for line generation / snapping? */
const gridValid = (g: BeatGrid): boolean =>
  Number.isFinite(g.bpm) && g.bpm > 0 && Number.isFinite(g.offset) && g.beatsPerBar >= 1;

/** time -> musical position in bars (float). bar index 0 == first downbeat. */
export function timeToBars(t: number, g: BeatGrid): number {
  return (t - g.offset) / barLen(g);
}

/** bars (float, 0-based) -> time in seconds. Inverse of {@link timeToBars}. */
export function barsToTime(bars: number, g: BeatGrid): number {
  return g.offset + bars * barLen(g);
}

const SUBDIVISIONS: Record<Exclude<SnapResolution, 'off'>, number> = {
  bar: 1,
  half: 2,
  quarter: 4,
  eighth: 8,
};

/** Step size in seconds for a snap resolution. */
export function snapStep(g: BeatGrid, snap: SnapResolution): number {
  if (snap === 'off') return 0;
  return barLen(g) / SUBDIVISIONS[snap];
}

/** Nearest grid time at a given subdivision. `off` returns `t` unchanged. */
export function snapTime(t: number, g: BeatGrid, snap: SnapResolution): number {
  if (snap === 'off' || !gridValid(g)) return t;
  const step = barLen(g) / SUBDIVISIONS[snap];
  return g.offset + Math.round((t - g.offset) / step) * step;
}

/** 0-based bar index containing time `t` (can be negative). */
export function barIndexAt(t: number, g: BeatGrid): number {
  return Math.floor(timeToBars(t, g) + EPS);
}

export interface GridLine {
  time: number; // seconds
  bar: number; // 1-indexed bar number for display (downbeat -> this bar's number)
  beat: number; // 1-indexed beat within the bar
  isDownbeat: boolean; // beat === 1
}

/**
 * Every BEAT line within [t0, t1] (inclusive of endpoints up to EPS). Downbeats are
 * tagged `isDownbeat`. This is the workhorse the ruler/grid renderer uses; consumers
 * draw a strong line + bar label on downbeats and lighter ticks on other beats.
 */
export function* gridLines(t0: number, t1: number, g: BeatGrid): Generator<GridLine> {
  if (!gridValid(g) || t1 < t0) return;
  const bl = beatLen(g);
  const bpb = g.beatsPerBar;
  // index of the first beat line at or after t0
  let n = Math.ceil((t0 - g.offset) / bl - EPS);
  let time = g.offset + n * bl;
  while (time <= t1 + EPS) {
    const bar0 = Math.floor(n / bpb);
    // positive modulo so negative indices (before offset) still cycle 0..bpb-1
    const beatInBar = ((n % bpb) + bpb) % bpb;
    yield {
      time,
      bar: bar0 + 1,
      beat: beatInBar + 1,
      isDownbeat: beatInBar === 0,
    };
    n += 1;
    time = g.offset + n * bl;
  }
}

/**
 * Bar boundaries (downbeats only) within [t0, t1] — the exact signature from spec §6.
 * `beat` is always 1. Use {@link gridLines} when beat-level ticks are also needed.
 */
export function* barLines(
  t0: number,
  t1: number,
  g: BeatGrid,
): Generator<{ time: number; bar: number; beat: number }> {
  if (!gridValid(g) || t1 < t0) return;
  const bar = barLen(g);
  let n = Math.ceil((t0 - g.offset) / bar - EPS);
  let time = g.offset + n * bar;
  while (time <= t1 + EPS) {
    yield { time, bar: n + 1, beat: 1 };
    n += 1;
    time = g.offset + n * bar;
  }
}

// ── Display formatting (spec §6) ─────────────────────────────────────────────

/**
 * `bars:beats` display, 1-indexed (e.g. bar index 0 beat 0 -> "1.1", and "17.3").
 * Times before the offset yield bar numbers <= 0 and are shown honestly.
 */
export function formatBarsBeats(t: number, g: BeatGrid): string {
  if (!gridValid(g)) return '–.–';
  const bl = beatLen(g);
  const totalBeats = (t - g.offset) / bl;
  const bpb = g.beatsPerBar;
  const bar0 = Math.floor(totalBeats / bpb + EPS);
  const beatInBar = Math.floor(totalBeats - bar0 * bpb + EPS);
  return `${bar0 + 1}.${beatInBar + 1}`;
}

/** `mm:ss.mmm` display. Negative times are clamped to 0 for display. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  // handle ms rounding to 1000
  const msFixed = ms === 1000 ? 0 : ms;
  const secsFixed = ms === 1000 ? secs + 1 : secs;
  return `${String(mins).padStart(2, '0')}:${String(secsFixed).padStart(2, '0')}.${String(
    msFixed,
  ).padStart(3, '0')}`;
}

/** Previous bar line strictly before `t` (for transport "previous bar" jump). */
export function prevBar(t: number, g: BeatGrid): number {
  const bar = barLen(g);
  const n = Math.ceil((t - g.offset) / bar - EPS) - 1;
  return g.offset + n * bar;
}

/**
 * Next bar line strictly after `t` (for transport "next bar" jump). When `t` is
 * exactly on a bar, this advances to the FOLLOWING bar (spec §11: don't no-op).
 */
export function nextBar(t: number, g: BeatGrid): number {
  const bar = barLen(g);
  const n = Math.floor((t - g.offset) / bar + EPS) + 1;
  return g.offset + n * bar;
}

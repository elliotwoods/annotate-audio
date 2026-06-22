import { describe, it, expect } from 'vitest';
import {
  beatLen,
  barLen,
  timeToBars,
  barsToTime,
  snapTime,
  snapStep,
  gridLines,
  barLines,
  barIndexAt,
  formatBarsBeats,
  formatClock,
  prevBar,
  nextBar,
} from './grid';
import type { BeatGrid } from '../model/types';

const g120: BeatGrid = { bpm: 120, offset: 0, beatsPerBar: 4, beatUnit: 4 };
// 120bpm => 0.5s/beat, 2s/bar
const g120off: BeatGrid = { bpm: 120, offset: 1, beatsPerBar: 4, beatUnit: 4 };
const g34: BeatGrid = { bpm: 90, offset: 0, beatsPerBar: 3, beatUnit: 4 };
// 90bpm => 0.6667s/beat, 2s/bar (3 beats)
const g78: BeatGrid = { bpm: 140, offset: 0.25, beatsPerBar: 7, beatUnit: 8 };

describe('beatLen / barLen', () => {
  it('computes seconds per beat and per bar', () => {
    expect(beatLen(g120)).toBeCloseTo(0.5, 9);
    expect(barLen(g120)).toBeCloseTo(2, 9);
    expect(barLen(g34)).toBeCloseTo(2, 9); // 3 * (60/90)
    expect(barLen(g78)).toBeCloseTo(7 * (60 / 140), 9);
  });
});

describe('timeToBars / barsToTime', () => {
  it('bar index 0 is the first downbeat (the offset)', () => {
    expect(timeToBars(0, g120)).toBeCloseTo(0, 9);
    expect(timeToBars(2, g120)).toBeCloseTo(1, 9);
    expect(timeToBars(1, g120off)).toBeCloseTo(0, 9);
  });
  it('is the inverse of barsToTime', () => {
    for (const bars of [-2.5, -1, 0, 0.333, 3, 17.75]) {
      expect(barsToTime(timeToBars(barsToTime(bars, g120off), g120off), g120off)).toBeCloseTo(
        barsToTime(bars, g120off),
        9,
      );
    }
  });
  it('allows negative bar floats before the offset', () => {
    expect(timeToBars(0, g120off)).toBeCloseTo(-0.5, 9);
    expect(barIndexAt(0, g120off)).toBe(-1);
  });
});

describe('snapTime', () => {
  it('snaps to the bar grid by default', () => {
    expect(snapTime(0.9, g120, 'bar')).toBeCloseTo(0, 9); // nearest bar to 0.9s is 0
    expect(snapTime(1.1, g120, 'bar')).toBeCloseTo(2, 9); // nearest bar is 2s
  });
  it('snaps to half/quarter/eighth bars', () => {
    // bar=2s: half=1s, quarter=0.5s, eighth=0.25s
    expect(snapStep(g120, 'half')).toBeCloseTo(1, 9);
    expect(snapStep(g120, 'quarter')).toBeCloseTo(0.5, 9);
    expect(snapStep(g120, 'eighth')).toBeCloseTo(0.25, 9);
    expect(snapTime(0.6, g120, 'half')).toBeCloseTo(1, 9);
    expect(snapTime(0.6, g120, 'quarter')).toBeCloseTo(0.5, 9);
    expect(snapTime(0.18, g120, 'eighth')).toBeCloseTo(0.25, 9);
  });
  it('respects offset', () => {
    expect(snapTime(1.1, g120off, 'bar')).toBeCloseTo(1, 9); // grid starts at 1s
    expect(snapTime(2.1, g120off, 'bar')).toBeCloseTo(3, 9);
  });
  it('off returns the time unchanged', () => {
    expect(snapTime(1.234, g120, 'off')).toBe(1.234);
  });
  it('returns t unchanged for an invalid grid', () => {
    expect(snapTime(1.234, { ...g120, bpm: 0 }, 'bar')).toBe(1.234);
  });
});

describe('gridLines', () => {
  it('yields every beat with downbeat tagging (4/4)', () => {
    const lines = [...gridLines(0, 4, g120)];
    // beats at 0,0.5,1,1.5,2,2.5,3,3.5,4
    expect(lines.map((l) => l.time)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4]);
    expect(lines[0]).toMatchObject({ bar: 1, beat: 1, isDownbeat: true });
    expect(lines[1]).toMatchObject({ bar: 1, beat: 2, isDownbeat: false });
    expect(lines[4]).toMatchObject({ bar: 2, beat: 1, isDownbeat: true });
    expect(lines[8]).toMatchObject({ bar: 3, beat: 1, isDownbeat: true });
  });
  it('handles 3/4 (non-4/4)', () => {
    const lines = [...gridLines(0, 4, g34)];
    // beat=2/3s; bar=2s (3 beats). downbeats at 0, 2, 4
    const downbeats = lines.filter((l) => l.isDownbeat).map((l) => Math.round(l.time * 1000) / 1000);
    expect(downbeats).toEqual([0, 2, 4]);
    // first bar has beats 1,2,3
    expect(lines.slice(0, 3).map((l) => l.beat)).toEqual([1, 2, 3]);
    expect(lines[3]).toMatchObject({ bar: 2, beat: 1 });
  });
  it('handles negative bars before the offset', () => {
    const lines = [...gridLines(-1, 1.5, g120off)];
    // grid offset=1s, beat=0.5s => beats at ...,-1,-0.5,0,0.5,1,1.5
    // bar numbering: bar index 0 == downbeat at t=1 => bar 1. t=0 is bar 0, t=-1 bar 0 too? let's check
    const at = (t: number) => lines.find((l) => Math.abs(l.time - t) < 1e-6);
    expect(at(1)).toMatchObject({ bar: 1, beat: 1, isDownbeat: true });
    // t=-1 => n = (-1-1)/0.5 = -4 => bar0 = floor(-4/4) = -1 => bar 0; beat ((-4%4)+4)%4=0 => downbeat
    expect(at(-1)).toMatchObject({ bar: 0, beat: 1, isDownbeat: true });
    // t=-0.5 => n=-3 => bar0=floor(-3/4)=-1 => bar 0; beat ((-3%4)+4)%4=1 => beat 2
    expect(at(-0.5)).toMatchObject({ bar: 0, beat: 2, isDownbeat: false });
  });
  it('yields nothing for an invalid grid or inverted range', () => {
    expect([...gridLines(0, 4, { ...g120, bpm: 0 })]).toHaveLength(0);
    expect([...gridLines(4, 0, g120)]).toHaveLength(0);
  });
});

describe('barLines', () => {
  it('yields only downbeats with the spec signature', () => {
    const bars = [...barLines(0, 6, g120)];
    expect(bars.map((b) => b.time)).toEqual([0, 2, 4, 6]);
    expect(bars.every((b) => b.beat === 1)).toBe(true);
    expect(bars.map((b) => b.bar)).toEqual([1, 2, 3, 4]);
  });
});

describe('prevBar / nextBar', () => {
  it('nextBar from exactly on a bar advances (no no-op)', () => {
    expect(nextBar(2, g120)).toBeCloseTo(4, 9);
    expect(nextBar(0, g120)).toBeCloseTo(2, 9);
  });
  it('nextBar / prevBar between bars', () => {
    expect(nextBar(2.3, g120)).toBeCloseTo(4, 9);
    expect(prevBar(2.3, g120)).toBeCloseTo(2, 9);
  });
  it('prevBar from exactly on a bar goes to the previous one', () => {
    expect(prevBar(4, g120)).toBeCloseTo(2, 9);
  });
  it('respects offset', () => {
    expect(nextBar(1, g120off)).toBeCloseTo(3, 9);
    expect(prevBar(3, g120off)).toBeCloseTo(1, 9);
  });
});

describe('formatBarsBeats', () => {
  it('is 1-indexed', () => {
    expect(formatBarsBeats(0, g120)).toBe('1.1');
    expect(formatBarsBeats(0.5, g120)).toBe('1.2');
    // 17.3 example: bar 17 beat 3 at offset0, bar=2s, beat=0.5s
    // bar17 starts at (17-1)*2 = 32s; beat3 => +2*0.5 = 1s => 33s
    expect(formatBarsBeats(33, g120)).toBe('17.3');
  });
  it('shows pre-offset times honestly', () => {
    expect(formatBarsBeats(0, g120off)).toBe('0.3'); // t=0, offset=1: -1s = -2 beats => bar0 -1=>"0", beat...
  });
});

describe('formatClock', () => {
  it('formats mm:ss.mmm', () => {
    expect(formatClock(0)).toBe('00:00.000');
    expect(formatClock(68.25)).toBe('01:08.250');
    expect(formatClock(3599.999)).toBe('59:59.999');
  });
  it('clamps negatives to zero', () => {
    expect(formatClock(-5)).toBe('00:00.000');
  });
});

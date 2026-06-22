import { describe, it, expect } from 'vitest';
import {
  timeToX,
  xToTime,
  durationToWidth,
  visibleRange,
  scrollForFocalZoom,
  clampScroll,
} from './transform';

const view = { pixelsPerSecond: 100, scrollSec: 10 };

describe('timeToX / xToTime', () => {
  it('are inverses', () => {
    for (const t of [0, 5, 10, 12.5, 33.333]) {
      expect(xToTime(timeToX(t, view), view)).toBeCloseTo(t, 9);
    }
  });
  it('map the scroll origin to x=0', () => {
    expect(timeToX(view.scrollSec, view)).toBe(0);
  });
  it('scale by pixelsPerSecond', () => {
    expect(timeToX(11, view)).toBeCloseTo(100, 9); // 1s past origin → 100px
    expect(durationToWidth(2, view)).toBeCloseTo(200, 9);
  });
});

describe('visibleRange', () => {
  it('returns [scroll, scroll + width/pps]', () => {
    expect(visibleRange(view, 800)).toEqual([10, 18]);
  });
});

describe('scrollForFocalZoom', () => {
  it('keeps the focal time pinned to the focal x at the new zoom', () => {
    const focalTime = 14;
    const focalX = timeToX(focalTime, view); // current x of that time
    const newPps = 250;
    const newScroll = scrollForFocalZoom(focalTime, focalX, newPps);
    const newView = { pixelsPerSecond: newPps, scrollSec: newScroll };
    // the focal time must still land at the same x
    expect(timeToX(focalTime, newView)).toBeCloseTo(focalX, 6);
  });
});

describe('clampScroll', () => {
  it('never goes below zero', () => {
    expect(clampScroll(-5, view, 800, 100)).toBe(0);
  });
  it('does not scroll wildly past the content end', () => {
    const v = { pixelsPerSecond: 100, scrollSec: 0 };
    const out = clampScroll(10_000, v, 800, 60); // 60s content, 8s window
    expect(out).toBeLessThanOrEqual(60);
    expect(out).toBeGreaterThanOrEqual(0);
  });
});

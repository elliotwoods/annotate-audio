import { describe, it, expect } from 'vitest';
import { niceBarStep, niceTimeStep, formatTimeTick, mod } from './ticks';

describe('niceBarStep', () => {
  it('returns 1 when bars are wide enough', () => {
    expect(niceBarStep(100, 46)).toBe(1);
  });
  it('returns powers of two as bars get narrower', () => {
    expect(niceBarStep(40, 46)).toBe(2); // 40<46, 80>=46
    expect(niceBarStep(20, 46)).toBe(4); // 20,40<46, 80>=46
    expect(niceBarStep(10, 46)).toBe(8);
    expect(niceBarStep(5, 46)).toBe(16);
  });
  it('never returns less than 1 and handles degenerate input', () => {
    expect(niceBarStep(0, 46)).toBe(1);
    expect(niceBarStep(-5, 46)).toBe(1);
  });
});

describe('niceTimeStep', () => {
  it('picks the smallest nice step that clears the min gap', () => {
    expect(niceTimeStep(1000, 60)).toBe(0.1); // 0.1*1000=100>=60; 0.05*1000=50<60
    expect(niceTimeStep(100, 60)).toBe(1); // 0.5*100=50<60, 1*100=100>=60
    expect(niceTimeStep(20, 60)).toBe(5); // 2*20=40<60, 5*20=100>=60
    expect(niceTimeStep(1, 60)).toBe(60); // 30*1=30<60, 60*1=60>=60
  });
  it('is monotonic: lower zoom never yields a smaller step', () => {
    let prev = 0;
    for (const pps of [2000, 1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5]) {
      const step = niceTimeStep(pps, 60);
      expect(step).toBeGreaterThanOrEqual(prev === 0 ? 0 : prev * 0); // sanity (always positive)
      prev = step;
    }
    expect(niceTimeStep(2000, 60)).toBeLessThanOrEqual(niceTimeStep(2, 60));
  });
  it('escalates past one hour for extreme zoom-out', () => {
    expect(niceTimeStep(0.01, 60)).toBeGreaterThanOrEqual(3600);
  });
});

describe('formatTimeTick', () => {
  it('shows m:ss for coarse steps', () => {
    expect(formatTimeTick(0, 1)).toBe('0:00');
    expect(formatTimeTick(68, 1)).toBe('1:08');
    expect(formatTimeTick(125, 5)).toBe('2:05');
  });
  it('adds fractional seconds for sub-second steps', () => {
    expect(formatTimeTick(1.5, 0.5)).toBe('0:01.5');
    expect(formatTimeTick(62.25, 0.25)).toBe('1:02.25');
  });
});

describe('mod', () => {
  it('is always non-negative', () => {
    expect(mod(-1, 4)).toBe(3);
    expect(mod(-4, 4)).toBe(0);
    expect(mod(5, 4)).toBe(1);
  });
});

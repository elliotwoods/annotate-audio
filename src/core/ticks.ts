// Adaptive ruler tick spacing (pure, testable). Chooses how many bars / how many
// seconds to put between drawn lines & labels so they never collide at any zoom.

/**
 * Bars between drawn lines/labels: the smallest power-of-two (>=1) such that the gap is
 * at least `minPx`. Powers of two keep musical alignment (label every 1/2/4/8/… bars).
 */
export function niceBarStep(pxPerBar: number, minPx: number): number {
  if (!(pxPerBar > 0)) return 1;
  let step = 1;
  while (step * pxPerBar < minPx && step < 1 << 20) step *= 2;
  return step;
}

// "Nice" time increments (seconds) for the time ruler.
const TIME_STEPS = [
  0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600,
];

/** Seconds between time ticks: the smallest nice step whose gap is at least `minPx`. */
export function niceTimeStep(pixelsPerSecond: number, minPx: number): number {
  if (!(pixelsPerSecond > 0)) return TIME_STEPS[TIME_STEPS.length - 1];
  for (const s of TIME_STEPS) {
    if (s * pixelsPerSecond >= minPx) return s;
  }
  // Beyond the largest preset: step up in whole hours.
  let s = 3600;
  while (s * pixelsPerSecond < minPx && s < 36000000) s += 3600;
  return s;
}

/**
 * Time-ruler tick label. Coarse steps (>= 1s) show `m:ss`; sub-second steps add
 * fractional seconds (one or two decimals) so adjacent ticks stay distinct.
 */
export function formatTimeTick(seconds: number, step: number): string {
  const s = Math.max(0, seconds);
  if (step >= 1) {
    const total = Math.round(s);
    const m = Math.floor(total / 60);
    const sec = total % 60;
    return `${m}:${String(sec).padStart(2, '0')}`;
  }
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  // Use as many decimals as the step needs to render distinctly (0.5/0.1 → 1; 0.25/0.05 → 2).
  const dec = Math.abs(step * 10 - Math.round(step * 10)) < 1e-9 ? 1 : 2;
  const [intPart, fracPart] = sec.toFixed(dec).split('.');
  return `${m}:${intPart.padStart(2, '0')}.${fracPart}`;
}

/** Positive modulo so negative bar indices (before the grid offset) cycle correctly. */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

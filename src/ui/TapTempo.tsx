// Tap-tempo control (spec §7.3). Extracted from BpmControls so it can live in the Tempo
// tools popover alongside auto-detection. Tap on each beat; "Apply" writes the running
// average to the grid BPM. Double-click the Tap button to reset the streak.

import { useCallback, useRef, useState } from 'react';
import { Timer } from 'lucide-react';
import { useStore } from '../store/store';
import './BpmControls.css';

/** Drop taps and restart the average if the user pauses for longer than this. */
const TAP_RESET_MS = 2000;
/** Keep at most this many recent taps for the running average (spec §7.3 "last N"). */
const MAX_TAPS = 8;

/** BPM from a list of tap timestamps (ms). Needs >= 2 taps; null otherwise. */
function bpmFromTaps(taps: number[]): number | null {
  if (taps.length < 2) return null;
  const span = taps[taps.length - 1] - taps[0];
  const intervals = taps.length - 1;
  if (span <= 0) return null;
  const avgIntervalMs = span / intervals;
  const bpm = 60000 / avgIntervalMs;
  return Number.isFinite(bpm) && bpm > 0 ? bpm : null;
}

export function TapTempo() {
  const setBpm = useStore((s) => s.setBpm);

  // Tap tempo: timestamps (performance.now) of the most recent taps.
  const tapsRef = useRef<number[]>([]);
  const [tapEstimate, setTapEstimate] = useState<number | null>(null);

  const handleTap = useCallback(() => {
    const now = performance.now();
    const taps = tapsRef.current;
    const last = taps[taps.length - 1];
    // Reset the streak after a long gap so a fresh tempo isn't averaged with the old one.
    let next = last !== undefined && now - last > TAP_RESET_MS ? [now] : [...taps, now];
    if (next.length > MAX_TAPS) next = next.slice(next.length - MAX_TAPS);
    tapsRef.current = next;
    setTapEstimate(bpmFromTaps(next));
  }, []);

  const applyTap = useCallback(() => {
    if (tapEstimate !== null) setBpm(Math.round(tapEstimate * 10) / 10);
  }, [tapEstimate, setBpm]);

  const resetTaps = useCallback(() => {
    tapsRef.current = [];
    setTapEstimate(null);
  }, []);

  return (
    <div className="bpm-field">
      <label>Tap tempo</label>
      <div className="bpm-tap-row">
        <button
          type="button"
          className="bpm-tap"
          onClick={handleTap}
          onDoubleClick={resetTaps}
          title="Tap on each beat (double-click to reset)"
        >
          <Timer size={15} aria-hidden /> Tap
        </button>
        <span className="bpm-tap-estimate tabular">
          {tapEstimate !== null ? `≈ ${tapEstimate.toFixed(1)} BPM` : '— —'}
        </span>
        <button
          type="button"
          className="primary"
          onClick={applyTap}
          disabled={tapEstimate === null}
          title="Apply the tapped tempo to the grid"
        >
          Apply
        </button>
      </div>
    </div>
  );
}

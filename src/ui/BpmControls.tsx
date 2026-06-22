// Manual beat-grid controls (spec §7.3). These are the PRIMARY path for setting a
// correct grid on soft, sustained material (§7.1) — detection is only a starting
// guess. Acceptance: tap-tempo + set-offset-to-playhead alone must produce a
// correct grid with detection disabled.

import { useCallback, useRef, useState } from 'react';
import { Timer } from 'lucide-react';
import { useStore } from '../store/store';
import { useGrid } from '../store/selectors';
import { transport } from '../audio/transport';
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

export function BpmControls() {
  const grid = useGrid();
  const setBpm = useStore((s) => s.setBpm);
  const setOffset = useStore((s) => s.setOffset);
  const setOffsetToTime = useStore((s) => s.setOffsetToTime);
  const nudgeOffset = useStore((s) => s.nudgeOffset);
  const setTimeSig = useStore((s) => s.setTimeSig);

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

  const onBpmInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.valueAsNumber;
      if (Number.isFinite(v)) setBpm(v);
    },
    [setBpm],
  );

  const onOffsetInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.valueAsNumber;
      if (Number.isFinite(v)) setOffset(v);
    },
    [setOffset],
  );

  const onNumInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const num = Math.round(e.target.valueAsNumber);
      if (Number.isFinite(num) && num >= 1) setTimeSig(num, grid.beatUnit);
    },
    [setTimeSig, grid.beatUnit],
  );

  const onDenInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const den = Math.round(e.target.valueAsNumber);
      if (Number.isFinite(den) && den >= 1) setTimeSig(grid.beatsPerBar, den);
    },
    [setTimeSig, grid.beatsPerBar],
  );

  return (
    <div className="bpm-controls">
      <div className="bpm-field">
        <label htmlFor="bpm-input">BPM</label>
        <input
          id="bpm-input"
          type="number"
          min={1}
          step={0.1}
          value={Number.isFinite(grid.bpm) ? Math.round(grid.bpm * 1000) / 1000 : ''}
          onChange={onBpmInput}
        />
      </div>

      <div className="bpm-field">
        <label htmlFor="offset-input">Offset (s)</label>
        <div className="bpm-offset-row">
          <input
            id="offset-input"
            type="number"
            step={0.001}
            value={Math.round(grid.offset * 1000) / 1000}
            onChange={onOffsetInput}
            className="bpm-offset-input"
          />
          <button
            type="button"
            className="ghost"
            title="Set offset to the current playhead position"
            onClick={() => setOffsetToTime(transport.position())}
          >
            Set to playhead
          </button>
          <button
            type="button"
            className="icon ghost"
            title="Nudge offset −5 ms"
            aria-label="Nudge offset minus 5 milliseconds"
            onClick={() => nudgeOffset(-0.005)}
          >
            −5ms
          </button>
          <button
            type="button"
            className="icon ghost"
            title="Nudge offset +5 ms"
            aria-label="Nudge offset plus 5 milliseconds"
            onClick={() => nudgeOffset(0.005)}
          >
            +5ms
          </button>
        </div>
      </div>

      <div className="bpm-field">
        <label>Time sig</label>
        <div className="bpm-timesig">
          <input
            type="number"
            min={1}
            step={1}
            value={grid.beatsPerBar}
            aria-label="Time signature numerator"
            onChange={onNumInput}
            className="bpm-timesig-input"
          />
          <span className="bpm-timesig-sep">/</span>
          <input
            type="number"
            min={1}
            step={1}
            value={grid.beatUnit}
            aria-label="Time signature denominator"
            onChange={onDenInput}
            className="bpm-timesig-input"
          />
        </div>
      </div>

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
    </div>
  );
}

// Manual beat-grid controls (spec §7.3). These are the PRIMARY path for setting a
// correct grid on soft, sustained material (§7.1) — detection is only a starting
// guess. Tap tempo + auto-detection live in the Tempo tools popover (TempoPopover);
// these inline fields cover numeric BPM, downbeat offset, and time signature.

import { useCallback } from 'react';
import { useStore } from '../store/store';
import { useGrid } from '../store/selectors';
import { transport } from '../audio/transport';
import './BpmControls.css';

export function BpmControls() {
  const grid = useGrid();
  const setBpm = useStore((s) => s.setBpm);
  const setOffset = useStore((s) => s.setOffset);
  const setOffsetToTime = useStore((s) => s.setOffsetToTime);
  const nudgeOffset = useStore((s) => s.nudgeOffset);
  const setTimeSig = useStore((s) => s.setTimeSig);

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
    </div>
  );
}

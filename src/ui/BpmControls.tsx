// Manual beat-grid controls (spec §7.3). These are the PRIMARY path for setting a
// correct grid on soft, sustained material (§7.1) — detection is only a starting
// guess. Tap tempo + auto-detection live in the Tempo tools popover (TempoPopover);
// these inline fields cover numeric BPM, downbeat offset, and time signature.
//
// The numeric values use EditableNumber: they read as plain text with a dotted
// underline and only become inputs when clicked, keeping the top bar light.

import { useStore } from '../store/store';
import { useGrid } from '../store/selectors';
import { transport } from '../audio/transport';
import { Crosshair } from 'lucide-react';
import { EditableNumber } from './EditableNumber';
import './BpmControls.css';

export function BpmControls() {
  const grid = useGrid();
  const setBpm = useStore((s) => s.setBpm);
  const setOffset = useStore((s) => s.setOffset);
  const setOffsetToTime = useStore((s) => s.setOffsetToTime);
  const nudgeOffset = useStore((s) => s.nudgeOffset);
  const setTimeSig = useStore((s) => s.setTimeSig);

  return (
    <div className="bpm-controls">
      <div className="bpm-item">
        <span className="bpm-label">BPM</span>
        <EditableNumber
          value={grid.bpm}
          onCommit={setBpm}
          min={1}
          step={0.1}
          width={48}
          ariaLabel="BPM"
          format={(n) => (Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : '–')}
        />
      </div>

      <div className="bpm-item">
        <span className="bpm-label">Offset</span>
        <EditableNumber
          value={grid.offset}
          onCommit={setOffset}
          step={0.001}
          width={56}
          ariaLabel="Grid offset in seconds"
          format={(n) => `${(Math.round(n * 1000) / 1000).toFixed(3)}s`}
        />
        <div className="bpm-nudge">
          <button
            type="button"
            className="icon ghost"
            title="Set offset to the current playhead position"
            aria-label="Set offset to playhead"
            onClick={() => setOffsetToTime(transport.position())}
          >
            <Crosshair size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="icon ghost"
            title="Nudge offset −5 ms"
            aria-label="Nudge offset minus 5 milliseconds"
            onClick={() => nudgeOffset(-0.005)}
          >
            −5
          </button>
          <button
            type="button"
            className="icon ghost"
            title="Nudge offset +5 ms"
            aria-label="Nudge offset plus 5 milliseconds"
            onClick={() => nudgeOffset(0.005)}
          >
            +5
          </button>
        </div>
      </div>

      <div className="bpm-item">
        <span className="bpm-label">Time</span>
        <span className="bpm-timesig">
          <EditableNumber
            value={grid.beatsPerBar}
            onCommit={(v) => setTimeSig(Math.round(v), grid.beatUnit)}
            min={1}
            step={1}
            width={20}
            ariaLabel="Time signature numerator"
          />
          <span className="bpm-timesig-sep">/</span>
          <EditableNumber
            value={grid.beatUnit}
            onCommit={(v) => setTimeSig(grid.beatsPerBar, Math.round(v))}
            min={1}
            step={1}
            width={20}
            ariaLabel="Time signature denominator"
          />
        </span>
      </div>
    </div>
  );
}

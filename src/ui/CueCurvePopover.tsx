// Editing panel shown UNDER a selected cue: switch text↔curve, pick a curve type, and set
// the easing shape of the selected control point. Portalled to <body> and positioned with
// fixed coords from the block's rect (the lane clips overflow, so an in-flow panel would be
// cut off). Non-modal (no backdrop): it's driven by selection and unmounts on deselect.

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BeatGrid, Block, CurveType, SegmentShape } from '../model/types';
import { useStore } from '../store/store';
import { useGrid } from '../store/selectors';
import { formatClock, formatBarsBeats, barLen } from '../core/grid';
import './CueCurvePopover.css';

interface CueCurvePopoverProps {
  block: Block;
  /** The selected block's element — the anchor the panel is positioned under. */
  anchorRef: React.RefObject<HTMLElement>;
  selectedPoint: number;
}

const TYPES: { type: CurveType; label: string; title: string }[] = [
  { type: 'ascending', label: 'Rise', title: 'Ascending' },
  { type: 'descending', label: 'Fall', title: 'Descending' },
  { type: 'peak', label: 'Peak', title: 'Rise then fall (movable inflection)' },
  { type: 'trapezium', label: 'ASR', title: 'Trapezium — attack, sustain, release (movable shoulders)' },
  { type: 'arbitrary', label: 'Free', title: 'Arbitrary — add/move/delete points' },
];

const SHAPES: { shape: SegmentShape; label: string; title: string }[] = [
  { shape: 'linear', label: 'Lin', title: 'Linear' },
  { shape: 'exp', label: 'Exp', title: 'Exponential (slow start)' },
  { shape: 'log', label: 'Log', title: 'Logarithmic / square-root (fast start)' },
  { shape: 'scurve', label: 'S', title: 'S-curve (ease in-out)' },
  { shape: 'step', label: 'Step', title: 'Step / square (hold then jump)' },
];

const PANEL_WIDTH = 270;

/** Duration in seconds as a compact "4.00s". */
function fmtDurSeconds(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

/** Duration as a bar count, e.g. "2 bars" / "1.5 bars" / "0.25 bars". */
function fmtDurBars(seconds: number, grid: BeatGrid): string {
  const bl = barLen(grid);
  if (!Number.isFinite(bl) || bl <= 0) return '–';
  const bars = Math.round((seconds / bl) * 100) / 100;
  return `${bars} ${bars === 1 ? 'bar' : 'bars'}`;
}

export function CueCurvePopover({ block, anchorRef, selectedPoint }: CueCurvePopoverProps): JSX.Element | null {
  const setCueMode = useStore((s) => s.setCueMode);
  const setCurveType = useStore((s) => s.setCurveType);
  const setPointShape = useStore((s) => s.setPointShape);
  const clearSelection = useStore((s) => s.clearSelection);
  const grid = useGrid();

  const [pos, setPos] = useState({ top: 0, left: 0 });

  const place = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 8));
    setPos({ top: r.bottom + 6, left });
  }, [anchorRef]);

  useEffect(() => {
    place();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [place, clearSelection]);

  const isCurve = block.mode === 'curve' && !!block.curve;
  const points = block.curve?.points ?? [];
  const duration = block.isPoint ? 0 : Math.max(0, block.end - block.start);
  // The shape applies to the segment LEAVING a point — inert on the last point.
  const shapeTargetable = isCurve && selectedPoint >= 0 && selectedPoint < points.length - 1;
  const currentShape = shapeTargetable ? points[selectedPoint].shape : undefined;

  return createPortal(
    <div
      className="cue-curve-popover"
      role="dialog"
      aria-label="Cue editor"
      style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="cue-curve-popover__row cue-curve-popover__mode">
        <button
          type="button"
          className={`ghost${!isCurve ? ' active' : ''}`}
          onClick={() => setCueMode(block.id, 'text')}
        >
          Text
        </button>
        <button
          type="button"
          className={`ghost${isCurve ? ' active' : ''}`}
          onClick={() => setCueMode(block.id, 'curve')}
        >
          Curve
        </button>
      </div>

      {isCurve && (
        <>
          <div className="cue-curve-popover__label">Type</div>
          <div className="cue-curve-popover__row">
            {TYPES.map((t) => (
              <button
                key={t.type}
                type="button"
                className={`ghost${block.curve?.type === t.type ? ' active' : ''}`}
                title={t.title}
                onClick={() => setCurveType(block.id, t.type)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="cue-curve-popover__label">
            {shapeTargetable ? `Shape of point ${selectedPoint + 1}` : 'Shape (select a point)'}
          </div>
          <div className="cue-curve-popover__row">
            {SHAPES.map((s) => (
              <button
                key={s.shape}
                type="button"
                className={`ghost${currentShape === s.shape ? ' active' : ''}`}
                title={s.title}
                disabled={!shapeTargetable}
                onClick={() => setPointShape(block.id, selectedPoint, s.shape)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Position (start) and duration, each shown in clock time and bars. */}
      <div className="cue-curve-popover__meta">
        <span className="cue-curve-popover__meta-label">Position</span>
        <span className="cue-curve-popover__meta-val">{formatClock(block.start)}</span>
        <span className="cue-curve-popover__meta-val">{formatBarsBeats(block.start, grid)}</span>
        <span className="cue-curve-popover__meta-label">Duration</span>
        <span className="cue-curve-popover__meta-val">{fmtDurSeconds(duration)}</span>
        <span className="cue-curve-popover__meta-val">{fmtDurBars(duration, grid)}</span>
      </div>
    </div>,
    document.body,
  );
}

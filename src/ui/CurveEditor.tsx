// SVG envelope + draggable control points for a curve-mode cue. Rendered INSIDE the block
// box (fills it via inset:0). The SVG is pointer-transparent so the block body drag still
// works; only the control-point handles capture the pointer. Point times snap to the grid /
// other cues (reusing core/snap), and a whole drag is one undo step (history grouping).

import { useRef } from 'react';
import type { Block } from '../model/types';
import { useView, useGrid, useSnap } from '../store/selectors';
import { useStore, beginHistoryGroup, endHistoryGroup } from '../store/store';
import { snapTimeWith, cueEdgeTimes, type SnapContext } from '../core/snap';
import { sampleCurve, clamp01 } from '../core/curve';

interface CurveEditorProps {
  block: Block; // guaranteed block.curve present
  color: string;
  /** Show draggable control points (cue selected). When false, only the curve is drawn. */
  editable: boolean;
  /** Block width in px — handles are hidden when the block is too narrow to grab them. */
  width: number;
  /** The block's outer element, used as the coordinate frame for pointer math. */
  containerRef: React.RefObject<HTMLElement>;
  selectedPoint: number;
  onSelectPoint: (i: number) => void;
}

/** Below this on-screen width, control points are hidden (still draws the curve line). */
const MIN_HANDLE_WIDTH = 24;

interface PointDrag {
  i: number;
  grouped: boolean;
  startClientX: number;
  startClientY: number;
  cueTimes: number[];
}

export function CurveEditor({
  block,
  color,
  editable,
  width,
  containerRef,
  selectedPoint,
  onSelectPoint,
}: CurveEditorProps): JSX.Element | null {
  const view = useView();
  const grid = useGrid();
  const snap = useSnap();
  const moveCurvePoint = useStore((s) => s.moveCurvePoint);
  const deleteCurvePoint = useStore((s) => s.deleteCurvePoint);

  const drag = useRef<PointDrag | null>(null);
  const captureElRef = useRef<Element | null>(null);
  const live = useRef({ view, grid, snap, block });
  live.current = { view, grid, snap, block };

  const curve = block.curve;
  if (!curve) return null;
  const points = curve.points;

  const samples = sampleCurve(points);
  // viewBox 0..1 with y inverted so v=1 is at the top.
  const d = samples.map((s, i) => `${i === 0 ? 'M' : 'L'} ${s.x} ${1 - s.y}`).join(' ');
  const dFill = `${d} L 1 1 L 0 1 Z`;

  const handlers = useRef({
    move(e: PointerEvent) {
      const d0 = drag.current;
      if (!d0) return;
      if (
        !d0.grouped &&
        Math.abs(e.clientX - d0.startClientX) + Math.abs(e.clientY - d0.startClientY) <= 2
      )
        return;
      if (!d0.grouped) {
        beginHistoryGroup('Move curve point');
        d0.grouped = true;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const { view, grid, snap, block } = live.current;
      const pts = block.curve?.points ?? [];
      const isEndpoint = d0.i === 0 || d0.i === pts.length - 1;
      let tNorm = (e.clientX - rect.left) / rect.width;
      const vNorm = clamp01(1 - (e.clientY - rect.top) / rect.height);
      // Interior points snap their TIME to grid / other cues (endpoints have t locked).
      let guide = null;
      if (!isEndpoint) {
        const span = block.end - block.start;
        const sec = block.start + clamp01(tNorm) * span;
        const ctx: SnapContext = {
          grid,
          snap,
          pixelsPerSecond: view.pixelsPerSecond,
          cueTimes: d0.cueTimes,
        };
        const r = e.altKey ? { value: sec, guide: null } : snapTimeWith(sec, ctx);
        guide = r.guide;
        tNorm = span > 0 ? (r.value - block.start) / span : tNorm;
      }
      moveCurvePoint(block.id, d0.i, tNorm, vNorm);
      useStore.getState().setSnapIndicator(guide);
    },
    up(e: PointerEvent) {
      window.removeEventListener('pointermove', handlers.current.move);
      window.removeEventListener('pointerup', handlers.current.up);
      window.removeEventListener('pointercancel', handlers.current.up);
      const el = captureElRef.current;
      if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      captureElRef.current = null;
      const d0 = drag.current;
      drag.current = null;
      if (d0?.grouped) endHistoryGroup();
      useStore.getState().setSnapIndicator(null);
    },
  });

  const beginPointDrag = (i: number, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectPoint(i);
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);
    captureElRef.current = el;
    drag.current = {
      i,
      grouped: false,
      startClientX: e.clientX,
      startClientY: e.clientY,
      cueTimes: cueEdgeTimes(useStore.getState().core.blocks, block.id),
    };
    window.addEventListener('pointermove', handlers.current.move);
    window.addEventListener('pointerup', handlers.current.up);
    window.addEventListener('pointercancel', handlers.current.up);
  };

  // Double-clicking an interior handle deletes it (arbitrary curves only).
  const onPointDoubleClick = (i: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (curve.type === 'arbitrary' && i > 0 && i < points.length - 1) {
      deleteCurvePoint(block.id, i);
      onSelectPoint(Math.max(0, i - 1));
    }
  };

  const showHandles = editable && width >= MIN_HANDLE_WIDTH;

  return (
    <div className="curve-editor" aria-hidden>
      <svg
        className="curve-editor__svg"
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        width="100%"
        height="100%"
      >
        <path className="curve-editor__fill" d={dFill} fill={color} />
        <path className="curve-editor__line" d={d} fill="none" stroke={color} />
      </svg>
      {showHandles &&
        points.map((p, i) => (
          <span
            key={i}
            className={`curve-point${i === selectedPoint ? ' selected' : ''}`}
            style={{ left: `${p.t * 100}%`, top: `${(1 - p.v) * 100}%`, borderColor: color }}
            onPointerDown={(e) => beginPointDrag(i, e)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => onPointDoubleClick(i, e)}
            title={
              curve.type === 'arbitrary' && i > 0 && i < points.length - 1
                ? 'Drag to move · double-click to delete'
                : 'Drag to move'
            }
          />
        ))}
    </div>
  );
}

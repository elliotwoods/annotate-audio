import { useEffect, useRef, useState } from 'react';
import type { Block } from '../model/types';
import { useView, useGrid, useSnap } from '../store/selectors';
import { useStore, beginHistoryGroup, endHistoryGroup } from '../store/store';
import { snapTime } from '../core/grid';
import { timeToX } from '../core/transform';
import './BlockView.css';

export interface BlockViewProps {
  block: Block;
  /** Row colour (hex) used to tint the block. */
  color: string;
  selected: boolean;
}

/** Minimum on-screen width for a ranged block so it stays grabbable. */
const MIN_WIDTH_PX = 2;

type DragKind = 'move' | 'start' | 'end';

interface DragState {
  kind: DragKind;
  id: string;
  startClientX: number;
  origStart: number;
  origEnd: number;
  /** Whether a history group has been opened (only once the pointer actually moves). */
  grouped: boolean;
}

export function BlockView({ block, color, selected }: BlockViewProps): JSX.Element {
  const view = useView();
  const grid = useGrid();
  const snap = useSnap();

  const selectBlock = useStore((s) => s.selectBlock);
  const moveBlock = useStore((s) => s.moveBlock);
  const resizeBlock = useStore((s) => s.resizeBlock);
  const setBlockLabel = useStore((s) => s.setBlockLabel);

  const drag = useRef<DragState | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(block.label);
  const inputRef = useRef<HTMLInputElement>(null);

  // Latest values for use inside pointer handlers without stale closures.
  const liveRef = useRef({ view, grid, snap });
  liveRef.current = { view, grid, snap };

  useEffect(() => {
    if (editing) {
      setDraftLabel(block.label);
      // focus + select after the input mounts
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, block.label]);

  const left = timeToX(block.start, view);
  const rawWidth = (block.end - block.start) * view.pixelsPerSecond;
  const width = Math.max(MIN_WIDTH_PX, rawWidth);

  const maybeSnap = (t: number, altKey: boolean): number =>
    altKey ? t : snapTime(t, liveRef.current.grid, liveRef.current.snap);

  const captureElRef = useRef<Element | null>(null);

  // Stable handler instances (so add/removeEventListener pair correctly across the
  // re-renders triggered mid-drag). They read mutable refs for current state.
  const handlersRef = useRef({
    move(e: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      // Only open the undo group once the pointer actually moves, so a plain
      // click-to-select doesn't push a no-op history entry.
      if (!d.grouped && Math.abs(e.clientX - d.startClientX) <= 2) return;
      if (!d.grouped) {
        beginHistoryGroup();
        d.grouped = true;
      }
      const pps = liveRef.current.view.pixelsPerSecond;
      const dxSec = (e.clientX - d.startClientX) / pps;
      if (d.kind === 'move') {
        moveBlock(d.id, maybeSnap(d.origStart + dxSec, e.altKey));
      } else if (d.kind === 'start') {
        resizeBlock(d.id, 'start', maybeSnap(d.origStart + dxSec, e.altKey));
      } else {
        resizeBlock(d.id, 'end', maybeSnap(d.origEnd + dxSec, e.altKey));
      }
    },
    up(e: PointerEvent) {
      window.removeEventListener('pointermove', handlersRef.current.move);
      window.removeEventListener('pointerup', handlersRef.current.up);
      window.removeEventListener('pointercancel', handlersRef.current.up);
      const el = captureElRef.current;
      if (el?.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      captureElRef.current = null;
      const d = drag.current;
      drag.current = null;
      if (d?.grouped) endHistoryGroup();
    },
  });

  const beginDrag = (kind: DragKind, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget as Element;
    el.setPointerCapture(e.pointerId);
    captureElRef.current = el;
    drag.current = {
      kind,
      id: block.id,
      startClientX: e.clientX,
      origStart: block.start,
      origEnd: block.end,
      grouped: false,
    };
    window.addEventListener('pointermove', handlersRef.current.move);
    window.addEventListener('pointerup', handlersRef.current.up);
    window.addEventListener('pointercancel', handlersRef.current.up);
  };

  const onBodyPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editing) return;
    // Select on press (additive with Shift) before the drag begins.
    selectBlock(block.id, e.shiftKey);
    beginDrag('move', e);
  };

  const onBodyClick = (e: React.MouseEvent) => {
    // Selection happens on pointerdown; here we only stop the click from bubbling to
    // the lane (which would otherwise clear the selection).
    e.stopPropagation();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(true);
  };

  const commitLabel = () => {
    if (draftLabel !== block.label) setBlockLabel(block.id, draftLabel);
    setEditing(false);
  };
  const cancelLabel = () => {
    setDraftLabel(block.label);
    setEditing(false);
  };

  const labelInput = editing ? (
    <input
      ref={inputRef}
      className="block-view__label-input"
      value={draftLabel}
      onChange={(e) => setDraftLabel(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onBlur={commitLabel}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          commitLabel();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelLabel();
        }
      }}
      aria-label="Block label"
    />
  ) : null;

  if (block.isPoint) {
    // Point cue: a diamond marker centred on its start time.
    return (
      <div
        className={selected ? 'point-cue selected' : 'point-cue'}
        style={{ left }}
        onPointerDown={onBodyPointerDown}
        onClick={onBodyClick}
        onDoubleClick={onDoubleClick}
        title={block.label || undefined}
        role="button"
        aria-label={block.label ? `Point cue ${block.label}` : 'Point cue'}
      >
        <span className="point-cue__diamond" style={{ background: color }} />
        {selected && !editing && (
          <span
            className="point-cue__expand"
            style={{ borderColor: color }}
            onPointerDown={(e) => beginDrag('end', e)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            title="Drag right to convert to a ranged block"
            aria-label="Expand point cue to a range"
          />
        )}
        {editing ? (
          <div className="point-cue__editor">{labelInput}</div>
        ) : block.label ? (
          <span className="point-cue__label">{block.label}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={selected ? 'block-view selected' : 'block-view'}
      style={{
        left,
        width,
        background: hexWithAlpha(color, selected ? 0.42 : 0.26),
        borderColor: color,
      }}
      onPointerDown={onBodyPointerDown}
      onClick={onBodyClick}
      onDoubleClick={onDoubleClick}
      title={block.label || undefined}
      role="button"
      aria-label={block.label ? `Block ${block.label}` : 'Block'}
    >
      {selected && (
        <span
          className="block-view__handle block-view__handle--start"
          onPointerDown={(e) => beginDrag('start', e)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      )}
      {editing ? labelInput : <span className="block-view__label">{block.label}</span>}
      {selected && (
        <span
          className="block-view__handle block-view__handle--end"
          onPointerDown={(e) => beginDrag('end', e)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}

/** Convert a #rrggbb / #rgb hex to an rgba() string with the given alpha. */
function hexWithAlpha(hex: string, alpha: number): string {
  const v = hex.trim().replace('#', '');
  let r = 0;
  let g = 0;
  let b = 0;
  if (v.length === 3) {
    r = parseInt(v[0] + v[0], 16);
    g = parseInt(v[1] + v[1], 16);
    b = parseInt(v[2] + v[2], 16);
  } else if (v.length === 6) {
    r = parseInt(v.slice(0, 2), 16);
    g = parseInt(v.slice(2, 4), 16);
    b = parseInt(v.slice(4, 6), 16);
  } else {
    return hex;
  }
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return hex;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

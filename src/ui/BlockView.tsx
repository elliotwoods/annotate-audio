import { useEffect, useRef, useState } from 'react';
import type { Block } from '../model/types';
import { useView, useGrid, useSnap } from '../store/selectors';
import { useStore, beginHistoryGroup, endHistoryGroup } from '../store/store';
import {
  snapTimeWith,
  snapMoveStart,
  cueEdgeTimes,
  type SnapContext,
  type SnapResult,
} from '../core/snap';
import { timeToX } from '../core/transform';
import { clamp01 } from '../core/curve';
import { blockHeightForLabel, blockHeightForBlock, labelLineCount } from './metrics';
import { CurveEditor } from './CurveEditor';
import { CueCurvePopover } from './CueCurvePopover';
import './BlockView.css';

export interface BlockViewProps {
  block: Block;
  /** Row colour (hex) used to tint the block. */
  color: string;
  selected: boolean;
  /** Report the pixel height this block needs while editing (so the row grows live). */
  onEditHeight?: (px: number) => void;
}

/** Minimum on-screen width for a ranged block so it stays grabbable. */
const MIN_WIDTH_PX = 2;
const MAX_EDIT_ROWS = 10;

type DragKind = 'move' | 'start' | 'end';

interface DragState {
  kind: DragKind;
  id: string;
  startClientX: number;
  origStart: number;
  origEnd: number;
  grouped: boolean;
  /** Edge times of every OTHER cue, captured at gesture start, for cue-magnet snapping. */
  cueTimes: number[];
}

export function BlockView({ block, color, selected, onEditHeight }: BlockViewProps): JSX.Element {
  const view = useView();
  const grid = useGrid();
  const snap = useSnap();

  const selectBlock = useStore((s) => s.selectBlock);
  const moveBlock = useStore((s) => s.moveBlock);
  const resizeBlock = useStore((s) => s.resizeBlock);
  const setBlockLabel = useStore((s) => s.setBlockLabel);
  const addCurvePoint = useStore((s) => s.addCurvePoint);
  // Show the editing popover only when this cue is the sole selection (avoids popover spam
  // while rubber-band/shift multi-selecting).
  const soleSelected = useStore((s) => s.selection.length === 1 && s.selection[0] === block.id);

  const drag = useRef<DragState | null>(null);
  const [editing, setEditing] = useState(false);
  // Which curve control point the shape buttons act on (a transient UI cursor).
  const [selectedPoint, setSelectedPoint] = useState(0);
  const [draftLabel, setDraftLabel] = useState(block.label);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const liveRef = useRef({ view, grid, snap });
  liveRef.current = { view, grid, snap };

  // Guards against a double-commit: tearing down the editor (Enter/Escape sets
  // editing=false) unmounts the textarea, which fires a native blur → onBlur. The
  // flag ensures only the first of {keydown, unmount-blur} takes effect, so Escape
  // can't be undone by a trailing blur that saves the abandoned draft.
  const settledRef = useRef(false);

  useEffect(() => {
    if (editing) {
      settledRef.current = false;
      setDraftLabel(block.label);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing, block.label]);

  // While editing, report the height needed for the draft so the row grows live; reset
  // to 0 when not editing (or on unmount). The committed label drives the row otherwise.
  useEffect(() => {
    if (editing) onEditHeight?.(blockHeightForLabel(draftLabel));
    else onEditHeight?.(0);
    return () => onEditHeight?.(0);
  }, [editing, draftLabel, onEditHeight]);

  const isCurve = block.mode === 'curve' && !!block.curve && !block.isPoint;

  const left = timeToX(block.start, view);
  const rawWidth = (block.end - block.start) * view.pixelsPerSecond;
  const width = Math.max(MIN_WIDTH_PX, rawWidth);
  const ownHeight = isCurve
    ? blockHeightForBlock(block)
    : blockHeightForLabel(editing ? draftLabel : block.label);

  const captureElRef = useRef<Element | null>(null);

  const handlersRef = useRef({
    move(e: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      if (!d.grouped && Math.abs(e.clientX - d.startClientX) <= 2) return;
      if (!d.grouped) {
        beginHistoryGroup(d.kind === 'move' ? 'Move block' : 'Resize block');
        d.grouped = true;
      }
      const { view, grid, snap } = liveRef.current;
      const pps = view.pixelsPerSecond;
      const dxSec = (e.clientX - d.startClientX) / pps;
      // Alt during a gesture bypasses snapping entirely (spec §12).
      const ctx: SnapContext = { grid, snap, pixelsPerSecond: pps, cueTimes: d.cueTimes };
      let r: SnapResult;
      if (d.kind === 'move') {
        // Horizontal move + optional vertical move to whichever cue/section lane the
        // pointer is over (drag a cue between tracks). Either edge can magnet to a cue.
        const rawStart = d.origStart + dxSec;
        r = e.altKey
          ? { value: rawStart, guide: null }
          : snapMoveStart(rawStart, d.origEnd - d.origStart, ctx);
        moveBlock(d.id, r.value, rowIdUnderPointer(e.clientX, e.clientY));
      } else if (d.kind === 'start') {
        const raw = d.origStart + dxSec;
        r = e.altKey ? { value: raw, guide: null } : snapTimeWith(raw, ctx);
        resizeBlock(d.id, 'start', r.value);
      } else {
        const raw = d.origEnd + dxSec;
        r = e.altKey ? { value: raw, guide: null } : snapTimeWith(raw, ctx);
        resizeBlock(d.id, 'end', r.value);
      }
      // Show a guide at whatever this edge snapped to (cleared on pointer up).
      useStore.getState().setSnapIndicator(r.guide);
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
      useStore.getState().setSnapIndicator(null); // hide the guide when the gesture ends
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
      // Snap targets = every other cue's edges, captured once at gesture start.
      cueTimes: cueEdgeTimes(useStore.getState().core.blocks, block.id),
    };
    window.addEventListener('pointermove', handlersRef.current.move);
    window.addEventListener('pointerup', handlersRef.current.up);
    window.addEventListener('pointercancel', handlersRef.current.up);
  };

  const onBodyPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || editing) return;
    selectBlock(block.id, e.shiftKey);
    beginDrag('move', e);
  };

  const onBodyClick = (e: React.MouseEvent) => e.stopPropagation();

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isCurve) {
      // In curve mode, double-click adds a point (arbitrary curves only); never edits a label.
      if (block.curve?.type === 'arbitrary') {
        const rect = rootRef.current?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          const t = clamp01((e.clientX - rect.left) / rect.width);
          const v = clamp01(1 - (e.clientY - rect.top) / rect.height);
          addCurvePoint(block.id, t, v);
        }
      }
      return;
    }
    setEditing(true);
  };

  // Blur and Enter both commit (save the draft); Escape cancels (revert).
  const commitLabel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (draftLabel !== block.label) setBlockLabel(block.id, draftLabel);
    setEditing(false);
  };
  const cancelLabel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    setDraftLabel(block.label);
    setEditing(false);
  };

  // Keep the latest commit closure reachable from the document listener below.
  const commitRef = useRef(commitLabel);
  commitRef.current = commitLabel;

  // Clicking anywhere outside this cue while editing ACCEPTS the edit. The textarea's
  // onBlur alone isn't enough: clicking an empty lane calls preventDefault on its
  // pointerdown, which suppresses the blur — so commit explicitly from a capture-phase
  // document listener (settledRef dedupes against any blur that does fire).
  useEffect(() => {
    if (!editing) return;
    const onPointerDownOutside = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) commitRef.current();
    };
    document.addEventListener('pointerdown', onPointerDownOutside, true);
    return () => document.removeEventListener('pointerdown', onPointerDownOutside, true);
  }, [editing]);

  const labelEditor = editing ? (
    <textarea
      ref={inputRef}
      className="block-view__label-input"
      value={draftLabel}
      rows={Math.min(Math.max(labelLineCount(draftLabel), 1), MAX_EDIT_ROWS)}
      onChange={(e) => setDraftLabel(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onBlur={commitLabel}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commitLabel(); // Enter commits; Shift+Enter inserts a newline
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelLabel();
        }
      }}
      aria-label="Cue label (Shift+Enter for a new line)"
    />
  ) : null;

  if (block.isPoint) {
    return (
      <>
        <div
          ref={rootRef}
          className={`point-cue${selected ? ' selected' : ''}${editing ? ' editing' : ''}`}
          style={{ left }}
          onPointerDown={onBodyPointerDown}
          onClick={onBodyClick}
          onDoubleClick={onDoubleClick}
          title={block.label || undefined}
          role="button"
          aria-label={block.label ? `Milestone ${block.label}` : 'Milestone'}
        >
          <span className="point-cue__diamond" style={{ background: color }} />
          {/* Reveal-on-hover (mouse near the milestone) handle; CSS gates visibility. */}
          {!editing && (
            <span
              className="point-cue__expand"
              style={{ borderColor: color }}
              onPointerDown={(e) => beginDrag('end', e)}
              onClick={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              title="Drag right to give the milestone a duration"
              aria-label="Expand milestone into a ranged cue"
            />
          )}
          {editing ? (
            <div className="point-cue__editor">{labelEditor}</div>
          ) : block.label ? (
            <span className="point-cue__label">{block.label}</span>
          ) : null}
        </div>
        {soleSelected && (
          <CueCurvePopover block={block} anchorRef={rootRef} selectedPoint={selectedPoint} />
        )}
      </>
    );
  }

  return (
    <>
      <div
        ref={rootRef}
        className={`block-view${selected ? ' selected' : ''}${editing ? ' editing' : ''}${isCurve ? ' curve' : ''}`}
        style={{
          left,
          width,
          height: ownHeight - 10,
          background: hexWithAlpha(color, isCurve ? (selected ? 0.16 : 0.1) : selected ? 0.42 : 0.26),
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
        {isCurve ? (
          <CurveEditor
            block={block}
            color={color}
            editable={selected}
            width={width}
            containerRef={rootRef}
            selectedPoint={selectedPoint}
            onSelectPoint={setSelectedPoint}
          />
        ) : editing ? (
          labelEditor
        ) : (
          <span className="block-view__label">{block.label}</span>
        )}
        {selected && (
          <span
            className="block-view__handle block-view__handle--end"
            onPointerDown={(e) => beginDrag('end', e)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        )}
      </div>
      {soleSelected && (
        <CueCurvePopover block={block} anchorRef={rootRef} selectedPoint={selectedPoint} />
      )}
    </>
  );
}

/** The cue/section lane row id under a viewport point, or undefined (gutter/track/group). */
function rowIdUnderPointer(x: number, y: number): string | undefined {
  const el = document.elementFromPoint(x, y) as Element | null;
  const lane = el?.closest('[data-lane-rowid]');
  return lane?.getAttribute('data-lane-rowid') ?? undefined;
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

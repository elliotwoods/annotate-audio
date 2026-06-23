import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderPlus, Plus } from 'lucide-react';
import type { Row } from '../model/types';
import {
  useVisibleRows,
  useBlocksByRow,
  useView,
  useGrid,
  useSnap,
  useAudio,
} from '../store/selectors';
import { useStore } from '../store/store';
import { snapTime } from '../core/grid';
import { timeToX, xToTime } from '../core/transform';
import { blockHeightForLabel, labelLineCount, rowHeightForLabels } from './metrics';
import { RowGutter } from './RowGutter';
import { BlockView } from './BlockView';
import { useRowDnD } from './useRowDnD';
import './Lanes.css';

interface RowChrome {
  depth: number;
  dragging: boolean;
  onGripPointerDown: (e: React.PointerEvent, rowId: string) => void;
}

export function Lanes(): JSX.Element {
  const visible = useVisibleRows();
  const addCueRow = useStore((s) => s.addCueRow);
  const addGroup = useStore((s) => s.addGroup);
  const laneWidth = useStore((s) => s.laneWidth);

  const lanesRef = useRef<HTMLDivElement>(null);
  const { draggingSubtree, indicator, onGripPointerDown } = useRowDnD(lanesRef);

  return (
    <div className="lanes" ref={lanesRef}>
      {visible.map(({ row, depth }) => {
        const chrome: RowChrome = {
          depth,
          dragging: draggingSubtree.has(row.id),
          onGripPointerDown,
        };
        if (row.kind === 'track') return <TrackLane key={row.id} row={row} laneWidth={laneWidth} chrome={chrome} />;
        if (row.kind === 'group') return <GroupLane key={row.id} row={row} laneWidth={laneWidth} chrome={chrome} />;
        return <CueLane key={row.id} row={row} laneWidth={laneWidth} chrome={chrome} />;
      })}

      {indicator && (
        <div
          className={`lanes__drop${indicator.into ? ' into' : ''}${indicator.valid ? '' : ' invalid'}`}
          style={{ top: indicator.top, height: indicator.height }}
        />
      )}

      <div className="lanes__addrow">
        <div className="lanes__addrow-prep" />
        <div className="lanes__addrow-gutter">
          <button type="button" className="ghost lanes__addrow-btn" onClick={() => addCueRow()}>
            <Plus size={15} /> add row
          </button>
          <button type="button" className="ghost lanes__addrow-btn" onClick={() => addGroup()}>
            <FolderPlus size={15} /> group
          </button>
        </div>
        <div className="lanes__addrow-lane" />
      </div>
    </div>
  );
}

// ── Track row (non-interactive bar showing the audio) ────────────────────────

function TrackLane({ row, laneWidth, chrome }: { row: Row; laneWidth: number; chrome: RowChrome }): JSX.Element {
  const view = useView();
  const audio = useAudio();

  const barLeft = audio ? timeToX(0, view) : 0;
  const barWidth = audio ? Math.max(2, audio.duration * view.pixelsPerSecond) : 0;

  return (
    <div className="lanes__strip" data-rowid={row.id}>
      <div className="prep-cell prep-cell--empty" />
      <RowGutter row={row} depth={chrome.depth} />
      <div className="lanes__lane lanes__lane--track" style={{ width: laneWidth }}>
        {audio ? (
          <div
            className="track-bar"
            style={{ left: barLeft, width: barWidth, borderColor: row.color }}
            title={row.name}
          >
            <span className="track-bar__label">{row.name}</span>
          </div>
        ) : (
          <div className="track-bar track-bar--empty">
            <span className="track-bar__label">No audio loaded</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Group header row (folder) ─────────────────────────────────────────────────

function GroupLane({ row, laneWidth, chrome }: { row: Row; laneWidth: number; chrome: RowChrome }): JSX.Element {
  return (
    <div className={`lanes__strip lanes__strip--group${chrome.dragging ? ' dragging' : ''}`} data-rowid={row.id}>
      <div className="prep-cell prep-cell--empty" style={{ background: tint(row.color) }} />
      <RowGutter
        row={row}
        depth={chrome.depth}
        dragging={chrome.dragging}
        onGripPointerDown={chrome.onGripPointerDown}
      />
      <div
        className="lanes__lane lanes__lane--group"
        style={{ width: laneWidth, background: tint(row.color) }}
      />
    </div>
  );
}

// ── Prep cue (per-row pre-scene state note, in the left column) ───────────────

const MAX_PREP_ROWS = 12;

function PrepCue({ row, onEditHeight }: { row: Row; onEditHeight: (px: number) => void }): JSX.Element {
  const updateRow = useStore((s) => s.updateRow);
  const [draft, setDraft] = useState(row.prepCue ?? '');
  const [editing, setEditing] = useState(false);

  // Re-sync if the value changes externally (undo, load, cloud open…).
  useEffect(() => {
    setDraft(row.prepCue ?? '');
  }, [row.prepCue]);

  // While focused, report the height the draft needs so the row grows live.
  useEffect(() => {
    if (editing) onEditHeight(blockHeightForLabel(draft));
    return () => onEditHeight(0);
  }, [editing, draft, onEditHeight]);

  const commit = () => {
    setEditing(false);
    if (draft !== (row.prepCue ?? '')) updateRow(row.id, { prepCue: draft });
  };

  return (
    <div className="prep-cell">
      <textarea
        className="prep-cue"
        value={draft}
        placeholder="Prep…"
        rows={Math.min(Math.max(labelLineCount(draft), 1), MAX_PREP_ROWS)}
        onFocus={() => setEditing(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(row.prepCue ?? '');
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        aria-label={`Prep cue for ${row.name}`}
      />
    </div>
  );
}

/** A very faint tint of the group colour for its lane band. */
function tint(hex: string): string {
  const v = hex.replace('#', '');
  if (v.length !== 6) return 'transparent';
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return 'transparent';
  return `rgba(${r}, ${g}, ${b}, 0.08)`;
}

// ── Cue / Section row (interactive lane) ─────────────────────────────────────

interface PreviewRect {
  start: number;
  end: number;
}

function CueLane({ row, laneWidth, chrome }: { row: Row; laneWidth: number; chrome: RowChrome }): JSX.Element {
  const blocks = useBlocksByRow(row.id);
  const view = useView();
  const grid = useGrid();
  const snap = useSnap();
  const selection = useStore((s) => s.selection);

  const addBlock = useStore((s) => s.addBlock);
  const addPointCue = useStore((s) => s.addPointCue);
  const clearSelection = useStore((s) => s.clearSelection);

  const laneRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<PreviewRect | null>(null);
  // Height the in-progress label editor needs, so the row grows live while typing.
  const [editHeight, setEditHeight] = useState(0);

  // Row grows to fit the tallest multi-line label among its blocks AND its prep cue
  // (spec: auto height), plus at least the height the active editor needs.
  const committedHeight = useMemo(
    () => Math.max(rowHeightForLabels(blocks.map((b) => b.label)), blockHeightForLabel(row.prepCue ?? '')),
    [blocks, row.prepCue],
  );
  const rowHeight = Math.max(committedHeight, editHeight);

  const gesture = useRef<{ startClientX: number; rowId: string } | null>(null);
  const liveRef = useRef({ view, grid, snap });
  liveRef.current = { view, grid, snap };

  const clientXToTime = (clientX: number): number => {
    const rect = laneRef.current?.getBoundingClientRect();
    const x = rect ? clientX - rect.left : clientX;
    return xToTime(x, liveRef.current.view);
  };

  const maybeSnap = (t: number, altKey: boolean): number =>
    altKey ? t : snapTime(t, liveRef.current.grid, liveRef.current.snap);

  const handlersRef = useRef({
    move(e: PointerEvent) {
      const g = gesture.current;
      if (!g) return;
      const startT = Math.max(0, maybeSnap(clientXToTime(g.startClientX), e.altKey));
      const t = Math.max(0, maybeSnap(clientXToTime(e.clientX), e.altKey));
      setPreview({ start: Math.min(startT, t), end: Math.max(startT, t) });
    },
    up(e: PointerEvent) {
      window.removeEventListener('pointermove', handlersRef.current.move);
      window.removeEventListener('pointerup', handlersRef.current.up);
      window.removeEventListener('pointercancel', handlersRef.current.up);
      const lane = laneRef.current;
      if (lane?.hasPointerCapture(e.pointerId)) lane.releasePointerCapture(e.pointerId);

      const g = gesture.current;
      gesture.current = null;
      setPreview(null);
      if (!g) return;

      if (Math.abs(e.clientX - g.startClientX) <= 3) {
        clearSelection();
        return;
      }
      const startT = Math.max(0, maybeSnap(clientXToTime(g.startClientX), e.altKey));
      const t = Math.max(0, maybeSnap(clientXToTime(e.clientX), e.altKey));
      const a = Math.min(startT, t);
      const b = Math.max(startT, t);
      if (b > a) addBlock(g.rowId, a, b);
    },
  });

  const onLanePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    gesture.current = { startClientX: e.clientX, rowId: row.id };
    laneRef.current?.setPointerCapture(e.pointerId);
    window.addEventListener('pointermove', handlersRef.current.move);
    window.addEventListener('pointerup', handlersRef.current.up);
    window.addEventListener('pointercancel', handlersRef.current.up);
  };

  const onLaneDoubleClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const t = Math.max(0, maybeSnap(clientXToTime(e.clientX), e.altKey));
    addPointCue(row.id, t);
  };

  const previewLeft = preview ? timeToX(preview.start, view) : 0;
  const previewWidth = preview ? Math.max(2, (preview.end - preview.start) * view.pixelsPerSecond) : 0;

  return (
    <div
      className={`lanes__strip${chrome.dragging ? ' dragging' : ''}`}
      data-rowid={row.id}
      style={{ ['--row-h' as string]: `${rowHeight}px` }}
    >
      <PrepCue row={row} onEditHeight={setEditHeight} />
      <RowGutter
        row={row}
        depth={chrome.depth}
        dragging={chrome.dragging}
        onGripPointerDown={row.kind === 'section' ? undefined : chrome.onGripPointerDown}
      />
      <div
        ref={laneRef}
        className={`lanes__lane lanes__lane--${row.kind}`}
        data-lane-rowid={row.id}
        style={{ width: laneWidth }}
        onPointerDown={onLanePointerDown}
        onDoubleClick={onLaneDoubleClick}
      >
        {blocks.map((b) => (
          <BlockView
            key={b.id}
            block={b}
            color={row.color}
            selected={selection.includes(b.id)}
            onEditHeight={setEditHeight}
          />
        ))}
        {preview && (
          <div
            className="lanes__preview"
            style={{ left: previewLeft, width: previewWidth, borderColor: row.color }}
          />
        )}
      </div>
    </div>
  );
}

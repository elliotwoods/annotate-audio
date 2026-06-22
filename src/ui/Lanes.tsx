import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { Row } from '../model/types';
import {
  useSortedRows,
  useBlocksByRow,
  useView,
  useGrid,
  useSnap,
  useAudio,
} from '../store/selectors';
import { useStore } from '../store/store';
import { snapTime } from '../core/grid';
import { timeToX, xToTime } from '../core/transform';
import { RowGutter } from './RowGutter';
import { BlockView } from './BlockView';
import './Lanes.css';

export function Lanes(): JSX.Element {
  const rows = useSortedRows();
  const addCueRow = useStore((s) => s.addCueRow);
  const laneWidth = useStore((s) => s.laneWidth);

  return (
    <div className="lanes">
      {rows.map((row) =>
        row.kind === 'track' ? (
          <TrackLane key={row.id} row={row} laneWidth={laneWidth} />
        ) : (
          <CueLane key={row.id} row={row} laneWidth={laneWidth} />
        ),
      )}
      <div className="lanes__addrow">
        <button type="button" className="ghost lanes__addrow-btn" onClick={() => addCueRow()}>
          <Plus size={15} /> add row
        </button>
      </div>
    </div>
  );
}

// ── Track row (non-interactive bar showing the audio) ────────────────────────

function TrackLane({ row, laneWidth }: { row: Row; laneWidth: number }): JSX.Element {
  const view = useView();
  const audio = useAudio();

  const barLeft = audio ? timeToX(0, view) : 0;
  const barWidth = audio ? Math.max(2, audio.duration * view.pixelsPerSecond) : 0;

  return (
    <div className="lanes__strip">
      <RowGutter row={row} />
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

// ── Cue / Section row (interactive lane) ─────────────────────────────────────

interface PreviewRect {
  start: number;
  end: number;
}

function CueLane({ row, laneWidth }: { row: Row; laneWidth: number }): JSX.Element {
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

  // Mutable gesture state (avoids re-renders mid-drag except for the preview). We store
  // only the start clientX and recompute BOTH endpoints live, so holding Alt mid-drag
  // disables snap for the whole gesture — start included (spec §12).
  const gesture = useRef<{ startClientX: number; rowId: string } | null>(null);
  // Latest reactive values for use inside pointer handlers.
  const liveRef = useRef({ view, grid, snap });
  liveRef.current = { view, grid, snap };

  /** Convert a clientX to a lane-relative time using the lane's left edge. */
  const clientXToTime = (clientX: number): number => {
    const rect = laneRef.current?.getBoundingClientRect();
    const x = rect ? clientX - rect.left : clientX;
    return xToTime(x, liveRef.current.view);
  };

  const maybeSnap = (t: number, altKey: boolean): number =>
    altKey ? t : snapTime(t, liveRef.current.grid, liveRef.current.snap);

  // Stable handler instances so the add/removeEventListener pair matches across the
  // re-renders that the live preview triggers mid-drag. Creating a block is a single
  // store mutation at pointerup, so it needs no manual undo grouping (zundo records it).
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
        // A click on empty space → clear selection, create nothing.
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
    // Only react to a primary-button press on empty lane space (blocks stop propagation).
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
    if (e.target !== e.currentTarget) return; // ignore double-clicks on existing blocks
    const t = Math.max(0, maybeSnap(clientXToTime(e.clientX), e.altKey));
    addPointCue(row.id, t);
  };

  const previewLeft = preview ? timeToX(preview.start, view) : 0;
  const previewWidth = preview ? Math.max(2, (preview.end - preview.start) * view.pixelsPerSecond) : 0;

  return (
    <div className="lanes__strip">
      <RowGutter row={row} />
      <div
        ref={laneRef}
        className={`lanes__lane lanes__lane--${row.kind}`}
        style={{ width: laneWidth }}
        onPointerDown={onLanePointerDown}
        onDoubleClick={onLaneDoubleClick}
      >
        {blocks.map((b) => (
          <BlockView key={b.id} block={b} color={row.color} selected={selection.includes(b.id)} />
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

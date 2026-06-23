import { useEffect, useMemo, useRef, useState } from 'react';
import { FolderPlus, Plus } from 'lucide-react';
import type { Row } from '../model/types';
import {
  useVisibleRows,
  useBlocksByRow,
  useView,
  useGrid,
  useSnap,
} from '../store/selectors';
import { useStore, beginHistoryGroup, endHistoryGroup } from '../store/store';
import { snapTimeWith, cueEdgeTimes, type SnapContext, type SnapResult } from '../core/snap';
import { timeToX, xToTime } from '../core/transform';
import { barLen } from '../core/grid';
import { heldValueAt, type HeldCue } from '../core/curve';
import { blockHeightForLabel, labelLineCount, rowHeightForBlocks, CURVE_BLOCK_H } from './metrics';
import { RowGutter } from './RowGutter';
import { BlockView } from './BlockView';
import { useRowDnD } from './useRowDnD';
import { useMarquee } from './useMarquee';
import { setPointerTime } from './pointerTime';
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
  const { onMarqueeStart, overlay } = useMarquee(lanesRef);

  return (
    <div className="lanes" ref={lanesRef}>
      {/* The audio is shown once, in the waveform strip above; the fixed 'track' row
          carries no extra information, so it isn't rendered as its own lane here. */}
      {visible
        .filter(({ row }) => row.kind !== 'track')
        .map(({ row, depth }) => {
          const chrome: RowChrome = {
            depth,
            dragging: draggingSubtree.has(row.id),
            onGripPointerDown,
          };
          if (row.kind === 'group') return <GroupLane key={row.id} row={row} laneWidth={laneWidth} chrome={chrome} />;
          return (
            <CueLane
              key={row.id}
              row={row}
              laneWidth={laneWidth}
              chrome={chrome}
              onMarqueeStart={onMarqueeStart}
            />
          );
        })}

      {overlay}

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
  // Escape resets the draft then blurs; this flag stops the trailing onBlur from
  // re-saving the abandoned draft (the reset hasn't reached commit's closure yet).
  const cancelledRef = useRef(false);

  // Re-sync if the value changes externally (undo, load, cloud open…).
  useEffect(() => {
    setDraft(row.prepCue ?? '');
  }, [row.prepCue]);

  // While focused, report the height the draft needs so the row grows live.
  useEffect(() => {
    if (editing) onEditHeight(blockHeightForLabel(draft));
    return () => onEditHeight(0);
  }, [editing, draft, onEditHeight]);

  // Blur and Enter commit (save); Escape reverts. The flag makes Escape win over
  // the blur it triggers.
  const commit = () => {
    setEditing(false);
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
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
            cancelledRef.current = true;
            setDraft(row.prepCue ?? '');
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        aria-label={`Prep cue for ${row.name}`}
      />
    </div>
  );
}

/** Parse a #rrggbb hex into an "r, g, b" string for rgba(), or null if malformed. */
function rgbTriplet(hex: string): string | null {
  const v = hex.replace('#', '');
  if (v.length !== 6) return null;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return null;
  return `${r}, ${g}, ${b}`;
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

/** A touching boundary where ranged cue(s) end and ranged cue(s) begin at the same time. */
interface CueInterface {
  time: number;
  /** Ranged cues that END here (their `end` edge rolls). */
  priorIds: string[];
  /** Ranged cues that START here (their `start` edge rolls). */
  nextIds: string[];
}

function CueLane({
  row,
  laneWidth,
  chrome,
  onMarqueeStart,
}: {
  row: Row;
  laneWidth: number;
  chrome: RowChrome;
  onMarqueeStart: (e: React.PointerEvent) => void;
}): JSX.Element {
  const blocks = useBlocksByRow(row.id);
  const view = useView();
  const grid = useGrid();
  const snap = useSnap();
  const selection = useStore((s) => s.selection);

  const addBlock = useStore((s) => s.addBlock);
  const resizeBlock = useStore((s) => s.resizeBlock);

  const laneRef = useRef<HTMLDivElement>(null);
  // Height the in-progress label editor needs, so the row grows live while typing.
  const [editHeight, setEditHeight] = useState(0);

  // Row grows to fit the tallest multi-line label among its blocks AND its prep cue
  // (spec: auto height), plus at least the height the active editor needs.
  const committedHeight = useMemo(
    () => Math.max(rowHeightForBlocks(blocks), blockHeightForLabel(row.prepCue ?? '')),
    [blocks, row.prepCue],
  );
  const rowHeight = Math.max(committedHeight, editHeight);

  // Touching boundaries (a ranged cue ends exactly where another begins) with NEITHER side
  // selected — each gets a draggable "roll" handle that moves both edges together. Cues
  // snapped to one another share an exact edge time, so a tiny epsilon buckets them.
  const interfaces = useMemo<CueInterface[]>(() => {
    const EPS = 1e-4;
    const sel = new Set(selection);
    const bucket = new Map<number, CueInterface>();
    const at = (t: number): CueInterface => {
      const k = Math.round(t / EPS);
      let v = bucket.get(k);
      if (!v) {
        v = { time: t, priorIds: [], nextIds: [] };
        bucket.set(k, v);
      }
      return v;
    };
    for (const b of blocks) {
      if (b.isPoint) continue; // a roll needs two ranged neighbours
      at(b.end).priorIds.push(b.id);
      at(b.start).nextIds.push(b.id);
    }
    return [...bucket.values()].filter(
      (v) =>
        v.priorIds.length > 0 &&
        v.nextIds.length > 0 &&
        ![...v.priorIds, ...v.nextIds].some((id) => sel.has(id)),
    );
  }, [blocks, selection]);

  // "Current level" line for this row's curve cues: a continuous line that follows the HELD
  // envelope value across the timeline — tracing each cue's curve, holding flat between cues,
  // and extending out to both edges (a fade-up stays up until the next cue). Built as an SVG
  // path in screen-space px so it tracks scroll/zoom. Null when the row has no curve cues.
  const heldLine = useMemo(() => {
    // Milestone (0-duration) curve cues are INCLUDED: they read as an instantaneous jump of
    // the held level to their end value (heldValueAt handles the zero-width span).
    const cues: HeldCue[] = blocks
      .filter((b) => b.mode === 'curve' && b.curve)
      .map((b) => ({ start: b.start, end: b.end, points: b.curve!.points }))
      .sort((a, b) => a.start - b.start);
    if (cues.length === 0 || laneWidth <= 0) return null;
    // Map v∈[0,1] into the same vertical band the curve blocks draw in (top:5, height:62),
    // so the level line lines up with the cues' own curves.
    const top = 5;
    const band = CURVE_BLOCK_H - 10;
    const N = Math.min(800, Math.max(2, Math.round(laneWidth / 2)));
    const parts: string[] = [];
    for (let i = 0; i <= N; i++) {
      const x = (i / N) * laneWidth;
      const v = heldValueAt(cues, xToTime(x, view));
      const y = top + (1 - v) * band;
      parts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    return parts.join(' ');
  }, [blocks, laneWidth, view]);

  const heldStroke = `rgba(${rgbTriplet(row.color) ?? '255, 255, 255'}, 0.6)`;

  const iface = useRef<{
    startClientX: number;
    priorIds: string[];
    nextIds: string[];
    minT: number;
    maxT: number;
    cueTimes: number[];
    grouped: boolean;
  } | null>(null);
  const liveRef = useRef({ view, grid, snap });
  liveRef.current = { view, grid, snap };

  const clientXToTime = (clientX: number): number => {
    const rect = laneRef.current?.getBoundingClientRect();
    const x = rect ? clientX - rect.left : clientX;
    return xToTime(x, liveRef.current.view);
  };

  // Alt during a gesture bypasses snapping (spec §12). `cueTimes` are the other cues' edges
  // to magnet to; an empty array means grid-only snapping (e.g. fresh block create).
  const maybeSnap = (t: number, altKey: boolean, cueTimes: number[]): SnapResult => {
    if (altKey) return { value: t, guide: null };
    const { view, grid, snap } = liveRef.current;
    const ctx: SnapContext = { grid, snap, pixelsPerSecond: view.pixelsPerSecond, cueTimes };
    return snapTimeWith(t, ctx);
  };

  // Empty-lane drag → marquee selection (handled by the parent, spanning all rows). A plain
  // click (sub-threshold drag) clears the selection; both are decided in the marquee hook.
  const onLanePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (e.target !== e.currentTarget) return; // ignore clicks that land on a block / roll handle
    onMarqueeStart(e);
  };

  // Track the hovered time so a paste (Ctrl/⌘+V) can land under the cursor, snapped.
  const onLanePointerMove = (e: React.PointerEvent) => {
    setPointerTime(clientXToTime(e.clientX));
  };

  // Double-click creates a new ranged cue ~1 bar long, snapped to the grid/cues at the click.
  const onLaneDoubleClick = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    const cueTimes = cueEdgeTimes(useStore.getState().core.blocks);
    const t = Math.max(0, maybeSnap(clientXToTime(e.clientX), e.altKey, cueTimes).value);
    addBlock(row.id, t, t + barLen(grid));
  };

  // ── interface "roll" drag (move a shared boundary, resizing both neighbours) ──
  const ifaceHandlersRef = useRef({
    move(e: PointerEvent) {
      const g = iface.current;
      if (!g) return;
      if (!g.grouped && Math.abs(e.clientX - g.startClientX) <= 2) return;
      if (!g.grouped) {
        beginHistoryGroup('Move cue boundary');
        g.grouped = true;
      }
      const r = maybeSnap(clientXToTime(e.clientX), e.altKey, g.cueTimes);
      // Clamp so neither neighbour inverts (the boundary stays between them).
      const t = Math.min(g.maxT, Math.max(g.minT, r.value));
      for (const id of g.priorIds) resizeBlock(id, 'end', t);
      for (const id of g.nextIds) resizeBlock(id, 'start', t);
      // Only hint a snap target when the snap actually landed (not when clamped).
      useStore.getState().setSnapIndicator(t === r.value ? r.guide : null);
    },
    up(e: PointerEvent) {
      window.removeEventListener('pointermove', ifaceHandlersRef.current.move);
      window.removeEventListener('pointerup', ifaceHandlersRef.current.up);
      window.removeEventListener('pointercancel', ifaceHandlersRef.current.up);
      const lane = laneRef.current;
      if (lane?.hasPointerCapture(e.pointerId)) lane.releasePointerCapture(e.pointerId);
      const g = iface.current;
      iface.current = null;
      useStore.getState().setSnapIndicator(null);
      if (g?.grouped) endHistoryGroup();
    },
  });

  const onInterfacePointerDown = (e: React.PointerEvent, itf: CueInterface) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // don't start a lane marquee
    const all = useStore.getState().core.blocks;
    const involved = new Set([...itf.priorIds, ...itf.nextIds]);
    const priors = all.filter((b) => itf.priorIds.includes(b.id));
    const nexts = all.filter((b) => itf.nextIds.includes(b.id));
    if (!priors.length || !nexts.length) return;
    iface.current = {
      startClientX: e.clientX,
      priorIds: itf.priorIds,
      nextIds: itf.nextIds,
      // Keep both sides ranged: the boundary can't cross any prior's start or any next's end.
      minT: Math.max(...priors.map((b) => b.start)),
      maxT: Math.min(...nexts.map((b) => b.end)),
      // Magnet to every OTHER cue's edges (not the two we're rolling).
      cueTimes: all
        .filter((b) => !involved.has(b.id))
        .flatMap((b) => (b.isPoint ? [b.start] : [b.start, b.end])),
      grouped: false,
    };
    laneRef.current?.setPointerCapture(e.pointerId);
    window.addEventListener('pointermove', ifaceHandlersRef.current.move);
    window.addEventListener('pointerup', ifaceHandlersRef.current.up);
    window.addEventListener('pointercancel', ifaceHandlersRef.current.up);
  };

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
        onPointerMove={onLanePointerMove}
        onDoubleClick={onLaneDoubleClick}
      >
        {heldLine && (
          <svg className="lanes__held-line" width={laneWidth} height={rowHeight} aria-hidden>
            <path d={heldLine} fill="none" stroke={heldStroke} />
          </svg>
        )}
        {blocks.map((b) => (
          <BlockView
            key={b.id}
            block={b}
            color={row.color}
            selected={selection.includes(b.id)}
            onEditHeight={setEditHeight}
          />
        ))}
        {/* Roll handles at touching boundaries (neither neighbour selected): an invisible
            grab zone that reveals a line on hover, hinting a drag moves both edges. */}
        {interfaces.map((itf) => (
          <div
            key={`iface-${itf.priorIds.join('-')}|${itf.nextIds.join('-')}`}
            className="lanes__iface"
            style={{ left: timeToX(itf.time, view) }}
            onPointerDown={(e) => onInterfacePointerDown(e, itf)}
            title="Drag to move the boundary between these two cues"
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
}

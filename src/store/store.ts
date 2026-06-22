// Single Zustand store (spec §3). Wrapped with zundo for undo/redo.
//
// Slices:
//   core       — canonical, persisted, UNDOABLE content (schemaVersion/id/name/audio/
//                grid/rows/blocks/updatedAt). This is `Project` minus `view`.
//   view       — zoom/scroll/snap/follow. Persisted (folded into exported Project) but
//                NOT undoable — undoing a scroll/zoom is hostile.
//   playback   — transient transport mirror (isPlaying + anchor position). Never
//                persisted or undone. The *live* playhead position comes from the
//                transport singleton, not from here (avoids per-frame re-renders).
//   selection  — selected block ids. Transient, not undone.
//   detection  — current BPM-detection suggestion (transient).
//
// Undo grouping: discrete actions record automatically (zundo pushes the pre-change
// state). Continuous gestures (block drag/resize) wrap their live mutations in
// beginHistoryGroup()/endHistoryGroup() so the whole drag is ONE undo step.

import { create } from 'zustand';
import { temporal } from 'zundo';
import type { StoreApi } from 'zustand';
import type {
  AudioMeta,
  BeatGrid,
  Block,
  Project,
  ProjectCore,
  Row,
  SnapResolution,
  ViewState,
} from '../model/types';
import { makeBlock, makeCueRow, makeProject, joinProject, splitProject } from '../model/defaults';
import { snapTime } from '../core/grid';
import { xToTime, clampScroll } from '../core/transform';
import type { PeaksData } from '../audio/peaksTypes';

export interface PlaybackState {
  isPlaying: boolean;
  /** Anchor position (seconds): where we are when paused/stopped or where play started. */
  positionSec: number;
}

export type Confidence = 'low' | 'med' | 'high';

export interface DetectionState {
  status: 'running' | 'done' | 'error';
  bpm?: number;
  offsetCandidate?: number;
  confidence?: Confidence;
  /** Human-readable agreement note, e.g. "Percival 120 / Rhythm2013 121 — agree". */
  agreement?: string;
  /** Octave-error candidates incl. ½× and 2× (spec §7.2). */
  candidates?: number[];
  error?: string;
}

export interface StoreState {
  core: ProjectCore;
  view: ViewState;
  playback: PlaybackState;
  selection: string[];
  detection: DetectionState | null;
  /** Measured pixel width of the lane area (transient; not persisted/undone). */
  laneWidth: number;
  /** Computed waveform peaks for the loaded audio (transient; recomputed on load). */
  peaks: PeaksData | null;

  // ── project / meta ──────────────────────────────────────────────────────
  newProject: (name?: string) => void;
  loadProject: (project: Project) => void;
  /** Assemble the full Project (core + view) for export/persist; stamps updatedAt. */
  exportProject: () => Project;
  setProjectName: (name: string) => void;
  setAudioMeta: (meta: AudioMeta | null) => void;
  setPeaks: (peaks: PeaksData | null) => void;

  // ── grid ────────────────────────────────────────────────────────────────
  setGrid: (partial: Partial<BeatGrid>) => void;
  setBpm: (bpm: number) => void;
  setOffset: (offset: number) => void;
  nudgeOffset: (deltaSec: number) => void;
  setOffsetToTime: (t: number) => void;
  setTimeSig: (beatsPerBar: number, beatUnit: number) => void;

  // ── view ────────────────────────────────────────────────────────────────
  setView: (partial: Partial<ViewState>) => void;
  setPixelsPerSecond: (pps: number) => void;
  setScrollSec: (sec: number) => void;
  setSnap: (snap: SnapResolution) => void;
  setFollow: (follow: boolean) => void;
  toggleFollow: () => void;
  setLaneWidth: (px: number) => void;
  /** Zoom by a factor, keeping the time under `focalX` (default: viewport centre) fixed. */
  zoomBy: (factor: number, focalX?: number) => void;
  /** Set zoom so the whole content fits the lane area. */
  zoomToFit: () => void;

  // ── playback mirror (set by the transport singleton) ──────────────────────
  setPlayback: (partial: Partial<PlaybackState>) => void;

  // ── rows ──────────────────────────────────────────────────────────────────
  addCueRow: () => string;
  removeRow: (rowId: string) => void;
  updateRow: (rowId: string, partial: Partial<Pick<Row, 'name' | 'icon' | 'color'>>) => void;
  moveRow: (rowId: string, dir: -1 | 1) => void;
  reorderCueRows: (cueRowIdsInOrder: string[]) => void;

  // ── blocks ────────────────────────────────────────────────────────────────
  addBlock: (rowId: string, start: number, end: number, label?: string) => string;
  addPointCue: (rowId: string, time: number, label?: string) => string;
  updateBlock: (id: string, partial: Partial<Omit<Block, 'id' | 'rowId'>>) => void;
  moveBlock: (id: string, newStart: number) => void;
  resizeBlock: (id: string, edge: 'start' | 'end', time: number) => void;
  setBlockLabel: (id: string, label: string) => void;
  toggleBlockPoint: (id: string) => void;
  deleteBlocks: (ids: string[]) => void;
  deleteSelected: () => void;

  // ── selection ─────────────────────────────────────────────────────────────
  selectBlock: (id: string, additive?: boolean) => void;
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;

  // ── commands ──────────────────────────────────────────────────────────────
  /** Pull every block onto the current grid (spec §5.2 opt-in re-snap). */
  resnapAllToGrid: () => void;

  // ── detection ─────────────────────────────────────────────────────────────
  setDetection: (state: DetectionState | null) => void;
  applyDetection: (bpm: number, offset?: number) => void;
}

const now = () => Date.now();

/** Max undo history depth. Shared by zundo's `limit` and the manual gesture push. */
const HISTORY_LIMIT = 200;

function freshCore(name?: string): ProjectCore {
  const { core } = splitProject(makeProject(name));
  return { ...core, updatedAt: now() };
}

function nextCueOrder(rows: Row[]): number {
  return rows.reduce((m, r) => (r.kind === 'cue' ? Math.max(m, r.order) : m), 1) + 1;
}

function cueRowCount(rows: Row[]): number {
  return rows.filter((r) => r.kind === 'cue').length;
}

export const useStore = create<StoreState>()(
  temporal(
    (set, get) => {
      /** Apply an immutable change to core, bumping updatedAt. */
      const mutate = (changes: Partial<ProjectCore>) =>
        set((s) => ({ core: { ...s.core, ...changes, updatedAt: now() } }));

      return {
        core: freshCore(),
        view: makeProject().view,
        playback: { isPlaying: false, positionSec: 0 },
        selection: [],
        detection: null,
        laneWidth: 800,
        peaks: null,

        // ── project / meta ───────────────────────────────────────────────
        newProject: (name) => {
          const { core, view } = splitProject(makeProject(name));
          set({
            core: { ...core, updatedAt: now() },
            view,
            selection: [],
            detection: null,
            peaks: null,
            playback: { isPlaying: false, positionSec: 0 },
          });
          queueMicrotask(() => store.temporal.getState().clear());
        },

        loadProject: (project) => {
          const { core, view } = splitProject(project);
          set({
            core,
            view,
            selection: [],
            detection: null,
            peaks: null,
            playback: { isPlaying: false, positionSec: 0 },
          });
          queueMicrotask(() => store.temporal.getState().clear());
        },

        exportProject: () => {
          // Pure: assemble the full Project from core + view WITHOUT mutating the store.
          // (Mutating here would bump updatedAt and re-trigger the autosave subscription,
          // creating an endless save loop. `core.updatedAt` is already stamped on every
          // real edit by `mutate`, so it reflects the true last-modified time.)
          const s = get();
          return joinProject(s.core, s.view);
        },

        setProjectName: (name) => mutate({ name }),

        setAudioMeta: (meta) =>
          set((s) => {
            const rows = meta
              ? s.core.rows.map((r) =>
                  r.kind === 'track' ? { ...r, name: meta.fileName || r.name } : r,
                )
              : s.core.rows;
            return { core: { ...s.core, audio: meta, rows, updatedAt: now() } };
          }),

        setPeaks: (peaks) => set({ peaks }),

        // ── grid ──────────────────────────────────────────────────────────
        setGrid: (partial) => mutate({ grid: { ...get().core.grid, ...partial } }),
        setBpm: (bpm) => {
          if (!Number.isFinite(bpm) || bpm <= 0) return;
          mutate({ grid: { ...get().core.grid, bpm } });
        },
        setOffset: (offset) => mutate({ grid: { ...get().core.grid, offset } }),
        nudgeOffset: (deltaSec) =>
          mutate({ grid: { ...get().core.grid, offset: get().core.grid.offset + deltaSec } }),
        setOffsetToTime: (t) => mutate({ grid: { ...get().core.grid, offset: t } }),
        setTimeSig: (beatsPerBar, beatUnit) => {
          if (beatsPerBar < 1 || beatUnit < 1) return;
          mutate({ grid: { ...get().core.grid, beatsPerBar, beatUnit } });
        },

        // ── view (not undoable, not via mutate) ────────────────────────────
        setView: (partial) => set((s) => ({ view: { ...s.view, ...partial } })),
        setPixelsPerSecond: (pps) =>
          set((s) => ({ view: { ...s.view, pixelsPerSecond: Math.max(1, pps) } })),
        setScrollSec: (sec) => set((s) => ({ view: { ...s.view, scrollSec: Math.max(0, sec) } })),
        setSnap: (snap) => set((s) => ({ view: { ...s.view, snap } })),
        setFollow: (follow) => set((s) => ({ view: { ...s.view, followPlayhead: follow } })),
        toggleFollow: () =>
          set((s) => ({ view: { ...s.view, followPlayhead: !s.view.followPlayhead } })),
        setLaneWidth: (px) => {
          if (px > 0 && px !== get().laneWidth) set({ laneWidth: px });
        },
        zoomBy: (factor, focalX) => {
          const { view, laneWidth } = get();
          const fx = focalX ?? laneWidth / 2;
          const focalTime = xToTime(fx, view);
          const pps = Math.min(4000, Math.max(2, view.pixelsPerSecond * factor));
          let scrollSec = focalTime - fx / pps;
          const next = { ...view, pixelsPerSecond: pps };
          scrollSec = clampScroll(scrollSec, next, laneWidth, contentDurationOf(get()));
          set({ view: { ...next, scrollSec } });
        },
        zoomToFit: () => {
          const { laneWidth } = get();
          const dur = contentDurationOf(get());
          const pps = Math.min(4000, Math.max(2, laneWidth / Math.max(0.001, dur)));
          set((s) => ({ view: { ...s.view, pixelsPerSecond: pps, scrollSec: 0 } }));
        },

        // ── playback mirror ────────────────────────────────────────────────
        setPlayback: (partial) => set((s) => ({ playback: { ...s.playback, ...partial } })),

        // ── rows ────────────────────────────────────────────────────────────
        addCueRow: () => {
          const order = nextCueOrder(get().core.rows);
          const row = makeCueRow(order, cueRowCount(get().core.rows));
          mutate({ rows: [...get().core.rows, row] });
          return row.id;
        },

        removeRow: (rowId) => {
          const row = get().core.rows.find((r) => r.id === rowId);
          if (!row || row.kind !== 'cue') return; // fixed rows are not removable
          const rows = normalizeOrders(get().core.rows.filter((r) => r.id !== rowId));
          const blocks = get().core.blocks.filter((b) => b.rowId !== rowId);
          mutate({ rows, blocks });
          set((s) => ({ selection: s.selection.filter((id) => blocks.some((b) => b.id === id)) }));
        },

        updateRow: (rowId, partial) =>
          mutate({
            rows: get().core.rows.map((r) => (r.id === rowId ? { ...r, ...partial } : r)),
          }),

        moveRow: (rowId, dir) => {
          const rows = [...get().core.rows].sort((a, b) => a.order - b.order);
          const cues = rows.filter((r) => r.kind === 'cue');
          const idx = cues.findIndex((r) => r.id === rowId);
          if (idx < 0) return;
          const swapWith = idx + dir;
          if (swapWith < 0 || swapWith >= cues.length) return;
          const reordered = [...cues];
          [reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]];
          mutate({ rows: applyCueOrder(get().core.rows, reordered.map((r) => r.id)) });
        },

        reorderCueRows: (ids) => mutate({ rows: applyCueOrder(get().core.rows, ids) }),

        // ── blocks ────────────────────────────────────────────────────────
        addBlock: (rowId, start, end, label = '') => {
          const a = Math.max(0, Math.min(start, end));
          const b = Math.max(start, end);
          const block = makeBlock(rowId, a, b, label);
          mutate({ blocks: [...get().core.blocks, block] });
          set({ selection: [block.id] });
          return block.id;
        },

        addPointCue: (rowId, time, label = '') => {
          const t = Math.max(0, time);
          const block: Block = { ...makeBlock(rowId, t, t, label), isPoint: true };
          mutate({ blocks: [...get().core.blocks, block] });
          set({ selection: [block.id] });
          return block.id;
        },

        updateBlock: (id, partial) =>
          mutate({
            blocks: get().core.blocks.map((b) => (b.id === id ? normalizeBlock({ ...b, ...partial }) : b)),
          }),

        moveBlock: (id, newStart) =>
          mutate({
            blocks: get().core.blocks.map((b) => {
              if (b.id !== id) return b;
              const dur = b.end - b.start;
              const start = Math.max(0, newStart);
              return { ...b, start, end: start + dur };
            }),
          }),

        resizeBlock: (id, edge, time) =>
          mutate({
            blocks: get().core.blocks.map((b) => {
              if (b.id !== id) return b;
              const t = Math.max(0, time);
              if (edge === 'start') {
                const start = Math.min(t, b.end);
                const isPoint = b.isPoint && start === b.end;
                return { ...b, start, isPoint: start < b.end ? false : isPoint };
              } else {
                const end = Math.max(t, b.start);
                const isPoint = b.isPoint && end === b.start;
                return { ...b, end, isPoint: end > b.start ? false : isPoint };
              }
            }),
          }),

        setBlockLabel: (id, label) =>
          mutate({ blocks: get().core.blocks.map((b) => (b.id === id ? { ...b, label } : b)) }),

        toggleBlockPoint: (id) =>
          mutate({
            blocks: get().core.blocks.map((b) => {
              if (b.id !== id) return b;
              if (b.isPoint) {
                // point -> ranged: give it a bar's worth of length as a starting span
                const span = barSpan(get().core.grid);
                return { ...b, isPoint: false, end: b.start + span };
              }
              return { ...b, isPoint: true, end: b.start };
            }),
          }),

        deleteBlocks: (ids) => {
          const set0 = new Set(ids);
          mutate({ blocks: get().core.blocks.filter((b) => !set0.has(b.id)) });
          set((s) => ({ selection: s.selection.filter((id) => !set0.has(id)) }));
        },

        deleteSelected: () => {
          const ids = new Set(get().selection);
          if (ids.size === 0) return;
          mutate({ blocks: get().core.blocks.filter((b) => !ids.has(b.id)) });
          set({ selection: [] });
        },

        // ── selection ──────────────────────────────────────────────────────
        selectBlock: (id, additive = false) =>
          set((s) => {
            if (!additive) return { selection: [id] };
            return s.selection.includes(id)
              ? { selection: s.selection.filter((x) => x !== id) }
              : { selection: [...s.selection, id] };
          }),
        setSelection: (ids) => set({ selection: ids }),
        clearSelection: () => set({ selection: [] }),

        // ── commands ─────────────────────────────────────────────────────
        resnapAllToGrid: () => {
          const { grid, view } = { grid: get().core.grid, view: get().view };
          const res: SnapResolution = view.snap === 'off' ? 'bar' : view.snap;
          mutate({
            blocks: get().core.blocks.map((b) => {
              const start = snapTime(b.start, grid, res);
              if (b.isPoint) return { ...b, start, end: start };
              const end = Math.max(start, snapTime(b.end, grid, res));
              return { ...b, start, end };
            }),
          });
        },

        // ── detection ────────────────────────────────────────────────────
        setDetection: (state) => set({ detection: state }),
        applyDetection: (bpm, offset) =>
          mutate({
            grid: {
              ...get().core.grid,
              bpm,
              ...(offset !== undefined ? { offset } : {}),
            },
          }),
      };
    },
    {
      // Only `core` is tracked for undo/redo (spec: view/playback/selection excluded).
      partialize: (state): { core: ProjectCore } => ({ core: state.core }),
      limit: HISTORY_LIMIT,
      equality: (a, b) => a.core === b.core,
    },
  ),
);

// Late-bound self reference so actions can reach the temporal store.
const store = useStore as typeof useStore & {
  temporal: StoreApi<{
    pastStates: { core: ProjectCore }[];
    futureStates: { core: ProjectCore }[];
    undo: (steps?: number) => void;
    redo: (steps?: number) => void;
    clear: () => void;
    pause: () => void;
    resume: () => void;
    isTracking: boolean;
  }>;
};

// ── undo/redo grouping for continuous gestures ─────────────────────────────

/**
 * Start a single undo group: push the CURRENT content as a restore point, then pause
 * recording so the gesture's live mutations don't each create history. Call once at
 * gesture start (pointerdown of a block drag/resize).
 */
export function beginHistoryGroup(): void {
  const t = store.temporal.getState();
  const snapshot = { core: useStore.getState().core };
  store.temporal.setState((s) => {
    // Enforce the same cap zundo applies in its internal _handleSet, since this manual
    // push bypasses it (otherwise grouped gestures would grow history without bound).
    const past =
      s.pastStates.length >= HISTORY_LIMIT
        ? s.pastStates.slice(s.pastStates.length - HISTORY_LIMIT + 1)
        : s.pastStates;
    return { pastStates: [...past, snapshot], futureStates: [] };
  });
  t.pause();
}

/** End the undo group started by {@link beginHistoryGroup}; resume recording. */
export function endHistoryGroup(): void {
  store.temporal.getState().resume();
}

export function undo(): void {
  store.temporal.getState().undo();
}
export function redo(): void {
  store.temporal.getState().redo();
}
export function clearHistory(): void {
  store.temporal.getState().clear();
}
export const temporalStore = store.temporal;

// ── helpers (pure) ──────────────────────────────────────────────────────────

/** Local copy of content-duration (selectors.ts has the public version; avoids a cycle). */
function contentDurationOf(s: StoreState): number {
  if (s.core.audio) return s.core.audio.duration;
  const maxEnd = s.core.blocks.reduce((m, b) => Math.max(m, b.end), 0);
  return maxEnd > 0 ? maxEnd : 60;
}

function barSpan(grid: BeatGrid): number {
  const len = (60 / grid.bpm) * grid.beatsPerBar;
  return Number.isFinite(len) && len > 0 ? len : 1;
}

function normalizeBlock(b: Block): Block {
  if (b.isPoint) return { ...b, end: b.start };
  if (b.end < b.start) return { ...b, end: b.start };
  return b;
}

/** Ensure track=0, section=1, and cue rows get unique orders >= 2 by current order. */
function normalizeOrders(rows: Row[]): Row[] {
  const track = rows.find((r) => r.kind === 'track');
  const section = rows.find((r) => r.kind === 'section');
  const cues = rows.filter((r) => r.kind === 'cue').sort((a, b) => a.order - b.order);
  const out: Row[] = [];
  if (track) out.push({ ...track, order: 0 });
  if (section) out.push({ ...section, order: 1 });
  cues.forEach((r, i) => out.push({ ...r, order: i + 2 }));
  return out;
}

/** Apply a new cue-row ordering (by id) to the rows array, keeping fixed rows pinned. */
function applyCueOrder(rows: Row[], cueIdsInOrder: string[]): Row[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const track = rows.find((r) => r.kind === 'track');
  const section = rows.find((r) => r.kind === 'section');
  const out: Row[] = [];
  if (track) out.push({ ...track, order: 0 });
  if (section) out.push({ ...section, order: 1 });
  cueIdsInOrder.forEach((id, i) => {
    const r = byId.get(id);
    if (r && r.kind === 'cue') out.push({ ...r, order: i + 2 });
  });
  // append any cue rows not mentioned (safety) keeping them after
  let order = out.length;
  for (const r of rows) {
    if (r.kind === 'cue' && !cueIdsInOrder.includes(r.id)) out.push({ ...r, order: order++ });
  }
  return out;
}

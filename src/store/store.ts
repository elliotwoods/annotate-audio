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
import {
  makeBlock,
  makeCueRow,
  makeGroupRow,
  makeProject,
  joinProject,
  splitProject,
} from '../model/defaults';
import { snapTime } from '../core/grid';
import { xToTime, clampScroll } from '../core/transform';
import { normalizeTree, isDescendant, subtreeIds } from '../core/rowtree';
import type { PeaksData } from '../audio/peaksTypes';

export interface PlaybackState {
  isPlaying: boolean;
  /** Anchor position (seconds): where we are when paused/stopped or where play started. */
  positionSec: number;
}

/** Transient save/sync status for the top-bar indicator (never persisted/undone). */
export type SaveStatus = 'idle' | 'saving' | 'saved';

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
  /** Row-header (gutter) column width in px — a global editor preference (localStorage). */
  gutterWidth: number;
  /** Prep-cue column width in px — a global editor preference (localStorage). */
  prepWidth: number;
  /** Computed waveform peaks for the loaded audio (transient; recomputed on load). */
  peaks: PeaksData | null;
  /** Autosave/cloud-save status for the top-bar indicator (transient). */
  saveStatus: SaveStatus;

  // ── project / meta ──────────────────────────────────────────────────────
  newProject: (name?: string) => void;
  loadProject: (project: Project) => void;
  /**
   * Replace ONLY `core` with a collaborator's document (no undo entry, preserves the local
   * view/playback/selection). Use via {@link applyRemoteCoreNoHistory} so the temporal store
   * is paused around the change.
   */
  applyRemoteCore: (remoteCore: ProjectCore) => void;
  /** Assemble the full Project (core + view) for export/persist; stamps updatedAt. */
  exportProject: () => Project;
  setProjectName: (name: string) => void;
  setAudioMeta: (meta: AudioMeta | null) => void;
  setPeaks: (peaks: PeaksData | null) => void;
  setSaveStatus: (status: SaveStatus) => void;

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
  setGutterWidth: (px: number) => void;
  setPrepWidth: (px: number) => void;
  /** Zoom by a factor, keeping the time under `focalX` (default: viewport centre) fixed. */
  zoomBy: (factor: number, focalX?: number) => void;
  /** Set zoom so the whole content fits the lane area. */
  zoomToFit: () => void;
  /** Zoom so the current block selection fills the view (no-op if nothing selected). */
  zoomToSelection: () => void;

  // ── playback mirror (set by the transport singleton) ──────────────────────
  setPlayback: (partial: Partial<PlaybackState>) => void;

  // ── rows & groups ───────────────────────────────────────────────────────────
  addCueRow: (parentId?: string | null) => string;
  addGroup: (parentId?: string | null) => string;
  removeRow: (rowId: string) => void;
  /** Delete a group: 'delete' removes its whole subtree (+blocks); 'ungroup' promotes children. */
  removeGroup: (groupId: string, mode: 'delete' | 'ungroup') => void;
  updateRow: (
    rowId: string,
    partial: Partial<Pick<Row, 'name' | 'icon' | 'color' | 'prepCue'>>,
  ) => void;
  toggleCollapse: (groupId: string) => void;
  moveRow: (rowId: string, dir: -1 | 1) => void;
  /** Move a row/group under `newParentId` (null = top level) at `index` among its movable siblings. */
  setParent: (rowId: string, newParentId: string | null, index?: number) => void;
  /** Reorder the movable children of `parentId` to match `idsInOrder`. */
  reorderSiblings: (parentId: string | null, idsInOrder: string[]) => void;
  /** Back-compat shim: reorder top-level cue rows. */
  reorderCueRows: (cueRowIdsInOrder: string[]) => void;

  // ── blocks ────────────────────────────────────────────────────────────────
  addBlock: (rowId: string, start: number, end: number, label?: string) => string;
  addPointCue: (rowId: string, time: number, label?: string) => string;
  updateBlock: (id: string, partial: Partial<Omit<Block, 'id' | 'rowId'>>) => void;
  /** Move a cue horizontally (newStart) and optionally to another row (cue/section lane). */
  moveBlock: (id: string, newStart: number, rowId?: string) => void;
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

// Gutter (row-header) width: a global editor preference persisted in localStorage,
// not part of any project. Clamped to a usable range.
const GUTTER_DEFAULT = 192;
const GUTTER_MIN = 140;
const GUTTER_MAX = 520;
const GUTTER_KEY = 'cuetl.gutterWidth';

const clampGutter = (px: number): number =>
  Math.min(GUTTER_MAX, Math.max(GUTTER_MIN, Math.round(px)));

// Prep-cue column width (also a localStorage editor preference).
const PREP_DEFAULT = 180;
const PREP_MIN = 110;
const PREP_MAX = 440;
const PREP_KEY = 'cuetl.prepWidth';

const clampPrep = (px: number): number => Math.min(PREP_MAX, Math.max(PREP_MIN, Math.round(px)));

function loadStoredWidth(key: string, fallback: number, clamp: (n: number) => number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? clamp(v) : fallback;
  } catch {
    return fallback;
  }
}

const loadGutterWidth = (): number => loadStoredWidth(GUTTER_KEY, GUTTER_DEFAULT, clampGutter);
const loadPrepWidth = (): number => loadStoredWidth(PREP_KEY, PREP_DEFAULT, clampPrep);

function freshCore(name?: string): ProjectCore {
  const { core } = splitProject(makeProject(name));
  return { ...core, updatedAt: now() };
}

function cueRowCount(rows: Row[]): number {
  return rows.filter((r) => r.kind === 'cue').length;
}

/** Movable children of a parent bucket (excludes the pinned track/section), sorted. */
function movableSiblings(rows: Row[], parentId: string | null): Row[] {
  return rows
    .filter((r) => (r.parentId ?? null) === parentId && r.kind !== 'track' && r.kind !== 'section')
    .sort((a, b) => a.order - b.order);
}

/** An order value that appends after the current siblings of `parentId`. */
function nextSiblingOrder(rows: Row[], parentId: string | null): number {
  let max = parentId === null ? 1 : -1; // top level reserves 0/1 for track/section
  for (const r of rows) if ((r.parentId ?? null) === parentId) max = Math.max(max, r.order);
  return max + 1;
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
        gutterWidth: loadGutterWidth(),
        prepWidth: loadPrepWidth(),
        peaks: null,
        saveStatus: 'idle',

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
          // Back-fill the tree shape for projects saved before groups existed (local DB
          // loads skip validation) and re-enforce invariants.
          set({
            core: { ...core, rows: normalizeTree(core.rows) },
            view,
            selection: [],
            detection: null,
            peaks: null,
            playback: { isPlaying: false, positionSec: 0 },
          });
          queueMicrotask(() => store.temporal.getState().clear());
        },

        applyRemoteCore: (remoteCore) =>
          set((s) => {
            const liveIds = new Set(remoteCore.blocks.map((b) => b.id));
            return {
              // Re-enforce tree invariants on the incoming rows, just like loadProject does.
              core: { ...remoteCore, rows: normalizeTree(remoteCore.rows) },
              // Drop any selection that referenced blocks the collaborator deleted.
              selection: s.selection.filter((id) => liveIds.has(id)),
              // view / playback / peaks / detection are intentionally left untouched.
            };
          }),

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
        setSaveStatus: (saveStatus) => set({ saveStatus }),

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
        setGutterWidth: (px) => {
          const w = clampGutter(px);
          if (w === get().gutterWidth) return;
          try {
            localStorage.setItem(GUTTER_KEY, String(w));
          } catch {
            /* storage unavailable — keep the in-memory value */
          }
          set({ gutterWidth: w });
        },
        setPrepWidth: (px) => {
          const w = clampPrep(px);
          if (w === get().prepWidth) return;
          try {
            localStorage.setItem(PREP_KEY, String(w));
          } catch {
            /* storage unavailable */
          }
          set({ prepWidth: w });
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
        zoomToSelection: () => {
          const { laneWidth, selection, core } = get();
          if (selection.length === 0) return;
          const sel = new Set(selection);
          const blocks = core.blocks.filter((b) => sel.has(b.id));
          if (blocks.length === 0) return;
          let t0 = Infinity;
          let t1 = -Infinity;
          for (const b of blocks) {
            t0 = Math.min(t0, b.start);
            t1 = Math.max(t1, b.end);
          }
          let span = t1 - t0;
          if (!(span > 1e-3)) {
            // Zero-length selection (e.g. a single point cue): frame ~2 bars around it.
            span = barSpan(core.grid) * 2;
            t0 = t0 - span / 2;
          }
          const pad = span * 0.08; // breathing room on each side
          const visible = span + pad * 2;
          const pps = Math.min(4000, Math.max(2, laneWidth / Math.max(0.001, visible)));
          const scrollSec = Math.max(0, t0 - pad);
          set((s) => ({ view: { ...s.view, pixelsPerSecond: pps, scrollSec } }));
        },

        // ── playback mirror ────────────────────────────────────────────────
        setPlayback: (partial) => set((s) => ({ playback: { ...s.playback, ...partial } })),

        // ── rows & groups ─────────────────────────────────────────────────────
        addCueRow: (parentId = null) => {
          const rows = get().core.rows;
          const row = makeCueRow(nextSiblingOrder(rows, parentId), cueRowCount(rows), parentId);
          mutate({ rows: normalizeTree([...rows, row]) });
          return row.id;
        },

        addGroup: (parentId = null) => {
          const rows = get().core.rows;
          const count = rows.filter((r) => r.kind === 'group').length;
          const row = makeGroupRow(nextSiblingOrder(rows, parentId), count, parentId);
          mutate({ rows: normalizeTree([...rows, row]) });
          return row.id;
        },

        removeRow: (rowId) => {
          const row = get().core.rows.find((r) => r.id === rowId);
          if (!row || row.kind !== 'cue') return; // fixed rows / groups handled elsewhere
          const rows = normalizeTree(get().core.rows.filter((r) => r.id !== rowId));
          const blocks = get().core.blocks.filter((b) => b.rowId !== rowId);
          mutate({ rows, blocks });
          set((s) => ({ selection: s.selection.filter((id) => blocks.some((b) => b.id === id)) }));
        },

        removeGroup: (groupId, mode) => {
          const all = get().core.rows;
          const group = all.find((r) => r.id === groupId);
          if (!group || group.kind !== 'group') return;
          if (mode === 'ungroup') {
            // Promote direct children to the group's parent at its slot, then drop the group.
            const next = all
              .filter((r) => r.id !== groupId)
              .map((r) =>
                r.parentId === groupId
                  ? { ...r, parentId: group.parentId, order: group.order + (r.order + 1) * 1e-3 }
                  : r,
              );
            mutate({ rows: normalizeTree(next) });
            return;
          }
          // delete: remove the whole subtree and the blocks on any removed cue rows.
          const ids = subtreeIds(all, groupId);
          const removedCueIds = new Set(
            all.filter((r) => ids.has(r.id) && r.kind === 'cue').map((r) => r.id),
          );
          const rows = normalizeTree(all.filter((r) => !ids.has(r.id)));
          const blocks = get().core.blocks.filter((b) => !removedCueIds.has(b.rowId));
          mutate({ rows, blocks });
          set((s) => ({ selection: s.selection.filter((id) => blocks.some((b) => b.id === id)) }));
        },

        updateRow: (rowId, partial) =>
          mutate({
            rows: get().core.rows.map((r) => (r.id === rowId ? { ...r, ...partial } : r)),
          }),

        toggleCollapse: (groupId) =>
          mutate({
            rows: get().core.rows.map((r) =>
              r.id === groupId && r.kind === 'group' ? { ...r, collapsed: !r.collapsed } : r,
            ),
          }),

        moveRow: (rowId, dir) => {
          const rows = get().core.rows;
          const row = rows.find((r) => r.id === rowId);
          if (!row || row.kind === 'track' || row.kind === 'section') return;
          const siblings = movableSiblings(rows, row.parentId ?? null);
          const idx = siblings.findIndex((r) => r.id === rowId);
          const swapWith = idx + dir;
          if (idx < 0 || swapWith < 0 || swapWith >= siblings.length) return;
          const ids = siblings.map((r) => r.id);
          [ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]];
          get().reorderSiblings(row.parentId ?? null, ids);
        },

        setParent: (rowId, newParentId, index) => {
          const rows = get().core.rows;
          const row = rows.find((r) => r.id === rowId);
          if (!row || row.kind === 'track' || row.kind === 'section') return;
          if (newParentId !== null) {
            const target = rows.find((r) => r.id === newParentId);
            if (!target || target.kind !== 'group') return;
            if (newParentId === rowId || isDescendant(rows, rowId, newParentId)) return; // no cycle
          }
          const dest = movableSiblings(rows, newParentId).filter((r) => r.id !== rowId);
          const clamped = Math.max(0, Math.min(index ?? dest.length, dest.length));
          let order: number;
          if (dest.length === 0) order = 0;
          else if (clamped === 0) order = dest[0].order - 0.5;
          else if (clamped >= dest.length) order = dest[dest.length - 1].order + 0.5;
          else order = (dest[clamped - 1].order + dest[clamped].order) / 2;
          const next = rows.map((r) => (r.id === rowId ? { ...r, parentId: newParentId, order } : r));
          mutate({ rows: normalizeTree(next) });
        },

        reorderSiblings: (parentId, idsInOrder) => {
          const pos = new Map(idsInOrder.map((id, i) => [id, i]));
          const next = get().core.rows.map((r) =>
            (r.parentId ?? null) === parentId && pos.has(r.id) ? { ...r, order: pos.get(r.id)! } : r,
          );
          mutate({ rows: normalizeTree(next) });
        },

        reorderCueRows: (ids) => get().reorderSiblings(null, ids),

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

        moveBlock: (id, newStart, rowId) =>
          mutate({
            blocks: get().core.blocks.map((b) => {
              if (b.id !== id) return b;
              const dur = b.end - b.start;
              const start = Math.max(0, newStart);
              let nextRow = b.rowId;
              if (rowId && rowId !== b.rowId) {
                const target = get().core.rows.find((r) => r.id === rowId);
                // Only block-holding lanes (cue/section) can receive a moved cue.
                if (target && (target.kind === 'cue' || target.kind === 'section')) nextRow = rowId;
              }
              return { ...b, rowId: nextRow, start, end: start + dur };
            }),
          }),

        resizeBlock: (id, edge, time) =>
          mutate({
            blocks: get().core.blocks.map((b) => {
              if (b.id !== id) return b;
              const t = Math.max(0, time);
              // Collapsing a cue to zero duration turns it into a milestone (a point
              // marker); dragging it back out to any positive duration makes it ranged.
              if (edge === 'start') {
                const start = Math.min(t, b.end);
                return { ...b, start, isPoint: start >= b.end };
              }
              const end = Math.max(t, b.start);
              return { ...b, end, isPoint: end <= b.start };
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

/**
 * Apply a collaborator's core document without recording it in THIS user's undo history.
 * Pausing the temporal store around the set means zundo never pushes a `pastStates` entry for
 * the remote change — so remote edits can't be "undone" locally and don't bury the user's own
 * history. (Mirrors the pause/resume that {@link beginHistoryGroup} uses for gestures.)
 */
export function applyRemoteCoreNoHistory(core: ProjectCore): void {
  const t = store.temporal.getState();
  const wasTracking = t.isTracking;
  t.pause();
  try {
    useStore.getState().applyRemoteCore(core);
  } finally {
    if (wasTracking) store.temporal.getState().resume();
  }
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
  // A zero- (or negative-) duration ranged cue collapses to a milestone marker.
  if (b.end <= b.start) return { ...b, isPoint: true, end: b.start };
  return b;
}


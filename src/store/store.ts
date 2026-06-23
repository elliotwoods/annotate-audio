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
  CueMode,
  CurveData,
  CurveType,
  Project,
  ProjectCore,
  Row,
  SegmentShape,
  SnapSettings,
  ViewState,
} from '../model/types';
import {
  makeCurve,
  defaultPointsFor,
  normalizePoints,
  moveCurvePoint as moveCurvePt,
  addCurvePoint as addCurvePt,
  deleteCurvePoint as deleteCurvePt,
  setPointShape as setPointShapeAt,
} from '../core/curve';
import {
  makeBlock,
  cloneBlock,
  makeCueRow,
  makeGroupRow,
  makeProject,
  joinProject,
  splitProject,
} from '../model/defaults';
import { snapTime, beatLen } from '../core/grid';
import { snapTimeWith, cueEdgeTimes, type SnapContext, type SnapGuide } from '../core/snap';
import { xToTime, clampScroll } from '../core/transform';
import { contentDuration } from '../core/contentExtent';
import { normalizeTree, isDescendant, subtreeIds } from '../core/rowtree';
import type { PeaksData } from '../audio/peaksTypes';

export interface PlaybackState {
  isPlaying: boolean;
  /** Anchor position (seconds): where we are when paused/stopped or where play started. */
  positionSec: number;
}

/** Transient save/sync status for the top-bar indicator (never persisted/undone). */
export type SaveStatus = 'idle' | 'saving' | 'saved';

/** Transient automatic-cloud-save status for the top-bar indicator. */
export type CloudSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/** Phases of an audio load, in order, used to label the waveform progress overlay. */
export type AudioLoadPhase = 'reading' | 'decoding' | 'analyzing';

/** Transient progress for an in-flight audio load (read → decode → peaks); null when idle. */
export interface AudioLoadProgress {
  phase: AudioLoadPhase;
  /** Best-effort overall completion in [0, 1]. The decode phase has no real signal, so it
   *  creeps; the file-read phase reflects actual bytes read. */
  progress: number;
  /** Name of the file being loaded, shown in the gutter/label. */
  fileName?: string;
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
  /** In-memory copy/cut buffer of blocks (transient; not persisted/undone). */
  clipboard: Block[];
  detection: DetectionState | null;
  /** Measured pixel width of the lane area (transient; not persisted/undone). */
  laneWidth: number;
  /** Row-header (gutter) column width in px — a global editor preference (localStorage). */
  gutterWidth: number;
  /** Prep-cue column width in px — a global editor preference (localStorage). */
  prepWidth: number;
  /** Computed waveform peaks for the loaded audio (transient; recomputed on load). */
  peaks: PeaksData | null;
  /** Progress of an in-flight audio load, for the waveform overlay (transient). */
  audioLoading: AudioLoadProgress | null;
  /** Local-autosave status for the top-bar indicator (transient). */
  saveStatus: SaveStatus;
  /** Automatic cloud-save status for the top-bar indicator (transient). */
  cloudSave: CloudSaveStatus;
  /** Epoch ms of the last successful cloud save, or null (transient). */
  cloudSavedAt: number | null;
  /** Human-readable detail for the most recent cloud-save failure (transient), or null. Shown
   *  when the user clicks the "Cloud save failed" indicator. */
  cloudSaveError: string | null;
  /** Active snap-guide target shown during a drag/resize, or null (transient). */
  snapIndicator: SnapGuide | null;
  /**
   * Short human-readable label for the edit that produced the current `core` (e.g.
   * "Set BPM 128", "Move block"). Set by `mutate`, included in zundo's `partialize` so each
   * history snapshot carries its own label and the label travels with undo/redo. Drives the
   * History dropdown; not persisted (it isn't part of `core`).
   */
  historyLabel: string;

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
  setAudioLoading: (state: AudioLoadProgress | null) => void;
  setSaveStatus: (status: SaveStatus) => void;
  setCloudSave: (
    status: CloudSaveStatus,
    detail?: { at?: number | null; error?: string | null },
  ) => void;

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
  /** Patch the snap settings (master toggle, cues toggle, single-select grid). */
  setSnap: (partial: Partial<SnapSettings>) => void;
  /** Set or clear the transient snap-guide indicator (during a drag/resize). */
  setSnapIndicator: (indicator: SnapGuide | null) => void;
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
  /** Move several cues to new starts at once (durations preserved, no row change) — group drag. */
  moveBlocks: (updates: { id: string; start: number }[]) => void;
  resizeBlock: (id: string, edge: 'start' | 'end', time: number) => void;
  setBlockLabel: (id: string, label: string) => void;
  toggleBlockPoint: (id: string) => void;
  deleteBlocks: (ids: string[]) => void;

  // ── cue curves ──────────────────────────────────────────────────────────────
  /** Switch a cue between text and curve mode; seeds/keeps curve data, preserves label. */
  setCueMode: (id: string, mode: CueMode) => void;
  /** Replace a curve's type, resetting its points to that type's canonical layout. */
  setCurveType: (id: string, type: CurveType) => void;
  /** Move curve point `i` to (t,v) in normalized [0,1] space (endpoints lock t). */
  moveCurvePoint: (id: string, i: number, t: number, v: number) => void;
  /** Insert a curve point at (t,v); inherits the split segment's shape. */
  addCurvePoint: (id: string, t: number, v: number) => void;
  /** Delete interior curve point `i` (endpoints are protected). */
  deleteCurvePoint: (id: string, i: number) => void;
  /** Set the leaving-segment shape of curve point `i` (inert on the last point). */
  setPointShape: (id: string, i: number, shape: SegmentShape) => void;
  deleteSelected: () => void;

  // ── selection ─────────────────────────────────────────────────────────────
  selectBlock: (id: string, additive?: boolean) => void;
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;

  // ── clipboard ─────────────────────────────────────────────────────────────
  /** Copy the current selection into the in-memory clipboard (no history). */
  copySelection: () => void;
  /** Copy the selection, then delete it (one undo step). */
  cutSelection: () => void;
  /**
   * Paste the clipboard. The earliest copied cue is anchored at `anchorTime` (snapped),
   * falling back to the playhead; relative timing between cues and their original rows are
   * preserved. New cues become the selection.
   */
  paste: (anchorTime?: number) => void;
  /** Duplicate the selection directly after each cue (ranged: butted; point: +1 beat). */
  duplicateSelection: () => void;

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
      /**
       * Apply an immutable change to core, bumping updatedAt. An optional `label` describes
       * the edit for the undo history (the History dropdown); when omitted the previous label
       * is kept. zundo captures the PRE-change `{ core, historyLabel }`, so the label set here
       * becomes the description of the state this edit produces.
       */
      const mutate = (changes: Partial<ProjectCore>, label?: string) =>
        set((s) => ({
          core: { ...s.core, ...changes, updatedAt: now() },
          ...(label !== undefined ? { historyLabel: label } : {}),
        }));

      return {
        core: freshCore(),
        view: makeProject().view,
        playback: { isPlaying: false, positionSec: 0 },
        selection: [],
        clipboard: [],
        detection: null,
        laneWidth: 800,
        gutterWidth: loadGutterWidth(),
        prepWidth: loadPrepWidth(),
        peaks: null,
        audioLoading: null,
        saveStatus: 'idle',
        cloudSave: 'idle',
        cloudSavedAt: null,
        cloudSaveError: null,
        snapIndicator: null,
        historyLabel: 'Opened',

        // ── project / meta ───────────────────────────────────────────────
        newProject: (name) => {
          const { core, view } = splitProject(makeProject(name));
          set({
            core: { ...core, updatedAt: now() },
            view,
            selection: [],
            clipboard: [],
            detection: null,
            peaks: null,
            playback: { isPlaying: false, positionSec: 0 },
            historyLabel: 'New project',
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
            clipboard: [],
            detection: null,
            peaks: null,
            playback: { isPlaying: false, positionSec: 0 },
            historyLabel: 'Opened',
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
              // Label the live state so a later local edit's pre-change snapshot isn't tagged
              // with this user's stale last-edit label. (The remote apply itself runs paused
              // via applyRemoteCoreNoHistory, so it never becomes its own history entry.)
              historyLabel: 'Synced from collaborator',
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

        setProjectName: (name) => mutate({ name }, 'Rename project'),

        setAudioMeta: (meta) =>
          set((s) => {
            const rows = meta
              ? s.core.rows.map((r) =>
                  r.kind === 'track' ? { ...r, name: meta.fileName || r.name } : r,
                )
              : s.core.rows;
            return {
              core: { ...s.core, audio: meta, rows, updatedAt: now() },
              historyLabel: meta ? 'Load audio' : 'Remove audio',
            };
          }),

        setPeaks: (peaks) => set({ peaks }),
        setAudioLoading: (audioLoading) => set({ audioLoading }),
        setSaveStatus: (saveStatus) => set({ saveStatus }),
        setCloudSave: (cloudSave, detail) =>
          set({
            cloudSave,
            cloudSavedAt: detail?.at !== undefined ? detail.at : get().cloudSavedAt,
            // Keep an error detail only while in the error state; clear it on any recovery so a
            // stale message never lingers behind a "Saved" chip.
            cloudSaveError:
              cloudSave === 'error'
                ? (detail?.error ?? get().cloudSaveError ?? 'Cloud save failed.')
                : null,
          }),

        // ── grid ──────────────────────────────────────────────────────────
        setGrid: (partial) => mutate({ grid: { ...get().core.grid, ...partial } }, 'Edit grid'),
        setBpm: (bpm) => {
          if (!Number.isFinite(bpm) || bpm <= 0) return;
          mutate({ grid: { ...get().core.grid, bpm } }, `Set BPM ${bpm}`);
        },
        setOffset: (offset) => mutate({ grid: { ...get().core.grid, offset } }, 'Set offset'),
        nudgeOffset: (deltaSec) =>
          mutate(
            { grid: { ...get().core.grid, offset: get().core.grid.offset + deltaSec } },
            'Nudge offset',
          ),
        setOffsetToTime: (t) => mutate({ grid: { ...get().core.grid, offset: t } }, 'Set offset'),
        setTimeSig: (beatsPerBar, beatUnit) => {
          if (beatsPerBar < 1 || beatUnit < 1) return;
          mutate(
            { grid: { ...get().core.grid, beatsPerBar, beatUnit } },
            `Time signature ${beatsPerBar}/${beatUnit}`,
          );
        },

        // ── view (not undoable, not via mutate) ────────────────────────────
        setView: (partial) => set((s) => ({ view: { ...s.view, ...partial } })),
        setPixelsPerSecond: (pps) =>
          set((s) => ({ view: { ...s.view, pixelsPerSecond: Math.max(1, pps) } })),
        setScrollSec: (sec) => set((s) => ({ view: { ...s.view, scrollSec: Math.max(0, sec) } })),
        setSnap: (partial) =>
          set((s) => ({ view: { ...s.view, snap: { ...s.view.snap, ...partial } } })),
        setSnapIndicator: (indicator) =>
          set((s) => {
            // No-op when unchanged so per-pointermove calls don't churn re-renders.
            const cur = s.snapIndicator;
            if (cur === indicator) return {};
            if (
              cur &&
              indicator &&
              cur.time === indicator.time &&
              cur.kind === indicator.kind
            ) {
              return {};
            }
            return { snapIndicator: indicator };
          }),
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
          mutate({ rows: normalizeTree([...rows, row]) }, 'Add cue row');
          return row.id;
        },

        addGroup: (parentId = null) => {
          const rows = get().core.rows;
          const count = rows.filter((r) => r.kind === 'group').length;
          const row = makeGroupRow(nextSiblingOrder(rows, parentId), count, parentId);
          mutate({ rows: normalizeTree([...rows, row]) }, 'Add group');
          return row.id;
        },

        removeRow: (rowId) => {
          const row = get().core.rows.find((r) => r.id === rowId);
          if (!row || row.kind !== 'cue') return; // fixed rows / groups handled elsewhere
          const rows = normalizeTree(get().core.rows.filter((r) => r.id !== rowId));
          const blocks = get().core.blocks.filter((b) => b.rowId !== rowId);
          mutate({ rows, blocks }, 'Delete row');
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
            mutate({ rows: normalizeTree(next) }, 'Ungroup');
            return;
          }
          // delete: remove the whole subtree and the blocks on any removed cue rows.
          const ids = subtreeIds(all, groupId);
          const removedCueIds = new Set(
            all.filter((r) => ids.has(r.id) && r.kind === 'cue').map((r) => r.id),
          );
          const rows = normalizeTree(all.filter((r) => !ids.has(r.id)));
          const blocks = get().core.blocks.filter((b) => !removedCueIds.has(b.rowId));
          mutate({ rows, blocks }, 'Delete group');
          set((s) => ({ selection: s.selection.filter((id) => blocks.some((b) => b.id === id)) }));
        },

        updateRow: (rowId, partial) =>
          mutate(
            { rows: get().core.rows.map((r) => (r.id === rowId ? { ...r, ...partial } : r)) },
            'name' in partial ? 'Rename row' : 'Edit row',
          ),

        toggleCollapse: (groupId) => {
          const group = get().core.rows.find((r) => r.id === groupId);
          mutate(
            {
              rows: get().core.rows.map((r) =>
                r.id === groupId && r.kind === 'group' ? { ...r, collapsed: !r.collapsed } : r,
              ),
            },
            group && group.kind === 'group' && !group.collapsed ? 'Collapse group' : 'Expand group',
          );
        },

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
          mutate({ rows: normalizeTree(next) }, 'Move row');
        },

        reorderSiblings: (parentId, idsInOrder) => {
          const pos = new Map(idsInOrder.map((id, i) => [id, i]));
          const next = get().core.rows.map((r) =>
            (r.parentId ?? null) === parentId && pos.has(r.id) ? { ...r, order: pos.get(r.id)! } : r,
          );
          mutate({ rows: normalizeTree(next) }, 'Reorder rows');
        },

        reorderCueRows: (ids) => get().reorderSiblings(null, ids),

        // ── blocks ────────────────────────────────────────────────────────
        addBlock: (rowId, start, end, label = '') => {
          const a = Math.max(0, Math.min(start, end));
          const b = Math.max(start, end);
          const block = makeBlock(rowId, a, b, label);
          mutate({ blocks: [...get().core.blocks, block] }, 'Add block');
          set({ selection: [block.id] });
          return block.id;
        },

        addPointCue: (rowId, time, label = '') => {
          const t = Math.max(0, time);
          const block: Block = { ...makeBlock(rowId, t, t, label), isPoint: true };
          mutate({ blocks: [...get().core.blocks, block] }, 'Add cue');
          set({ selection: [block.id] });
          return block.id;
        },

        updateBlock: (id, partial) =>
          mutate(
            {
              blocks: get().core.blocks.map((b) =>
                b.id === id ? normalizeBlock({ ...b, ...partial }) : b,
              ),
            },
            'Edit block',
          ),

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
          }, 'Move block'),

        moveBlocks: (updates) => {
          if (updates.length === 0) return;
          const next = new Map(updates.map((u) => [u.id, u.start]));
          mutate({
            blocks: get().core.blocks.map((b) => {
              const ns = next.get(b.id);
              if (ns === undefined) return b;
              const dur = b.end - b.start;
              const start = Math.max(0, ns);
              return { ...b, start, end: start + dur };
            }),
          }, 'Move blocks');
        },

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
          }, 'Resize block'),

        setBlockLabel: (id, label) =>
          mutate(
            { blocks: get().core.blocks.map((b) => (b.id === id ? { ...b, label } : b)) },
            'Label block',
          ),

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
          }, 'Toggle point'),

        // ── cue curves ───────────────────────────────────────────────────────
        setCueMode: (id, mode) =>
          mutate({
            blocks: get().core.blocks.map((b) => {
              if (b.id !== id) return b;
              if (mode === 'text') return normalizeBlock({ ...b, mode: 'text' });
              // → curve: keep any existing curve, else seed one; a curve needs a span,
              // so a point cue is first expanded to a bar-long ranged cue.
              const curve = b.curve ?? makeCurve('ascending');
              const ranged = b.isPoint
                ? { isPoint: false, end: b.start + barSpan(get().core.grid) }
                : {};
              return normalizeBlock({ ...b, ...ranged, mode: 'curve', curve });
            }),
          }, 'Cue mode'),

        setCurveType: (id, type) =>
          updateCurveBlock(get, mutate, id, () => ({ type, points: defaultPointsFor(type) }), 'Curve type'),

        moveCurvePoint: (id, i, t, v) =>
          updateCurveBlock(get, mutate, id, (c) => ({
            ...c,
            points: moveCurvePt(c.points, i, t, v),
          }), 'Move curve point'),

        addCurvePoint: (id, t, v) =>
          updateCurveBlock(get, mutate, id, (c) => ({ ...c, points: addCurvePt(c.points, t, v) }), 'Add curve point'),

        deleteCurvePoint: (id, i) =>
          updateCurveBlock(get, mutate, id, (c) => ({ ...c, points: deleteCurvePt(c.points, i) }), 'Delete curve point'),

        setPointShape: (id, i, shape) =>
          updateCurveBlock(get, mutate, id, (c) => ({
            ...c,
            points: setPointShapeAt(c.points, i, shape),
          }), 'Curve point shape'),

        deleteBlocks: (ids) => {
          const set0 = new Set(ids);
          mutate(
            { blocks: get().core.blocks.filter((b) => !set0.has(b.id)) },
            `Delete ${set0.size} ${set0.size === 1 ? 'block' : 'blocks'}`,
          );
          set((s) => ({ selection: s.selection.filter((id) => !set0.has(id)) }));
        },

        deleteSelected: () => {
          const ids = new Set(get().selection);
          if (ids.size === 0) return;
          mutate(
            { blocks: get().core.blocks.filter((b) => !ids.has(b.id)) },
            `Delete ${ids.size} ${ids.size === 1 ? 'block' : 'blocks'}`,
          );
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

        // ── clipboard ────────────────────────────────────────────────────
        copySelection: () => {
          const sel = new Set(get().selection);
          if (sel.size === 0) return;
          // Keep document order so paste lays the copies out deterministically.
          set({ clipboard: get().core.blocks.filter((b) => sel.has(b.id)).map((b) => cloneBlock(b)) });
        },

        cutSelection: () => {
          const sel = new Set(get().selection);
          if (sel.size === 0) return;
          const clipboard = get().core.blocks.filter((b) => sel.has(b.id)).map((b) => cloneBlock(b));
          mutate(
            { blocks: get().core.blocks.filter((b) => !sel.has(b.id)) },
            `Cut ${sel.size} ${sel.size === 1 ? 'block' : 'blocks'}`,
          );
          set({ clipboard, selection: [] });
        },

        paste: (anchorTime) => {
          const clip = get().clipboard;
          if (clip.length === 0) return;
          const { core, view } = get();
          // Anchor at the given time (e.g. the mouse) else the playhead, snapped to grid/cues.
          const raw = anchorTime ?? get().playback.positionSec ?? 0;
          const ctx: SnapContext = {
            grid: core.grid,
            snap: view.snap,
            pixelsPerSecond: view.pixelsPerSecond,
            cueTimes: cueEdgeTimes(core.blocks),
          };
          const anchor = Math.max(0, snapTimeWith(raw, ctx).value);
          const minStart = Math.min(...clip.map((b) => b.start));
          const offset = anchor - minStart;
          // Keep each copy on its original row if that row still holds cues, else the first cue row.
          const rowOk = (id: string) => {
            const r = core.rows.find((x) => x.id === id);
            return !!r && (r.kind === 'cue' || r.kind === 'section');
          };
          const fallbackRow = core.rows.find((r) => r.kind === 'cue')?.id;
          const news: Block[] = [];
          for (const b of clip) {
            const rowId = rowOk(b.rowId) ? b.rowId : fallbackRow;
            if (!rowId) continue;
            const start = Math.max(0, b.start + offset);
            const end = b.isPoint ? start : Math.max(start, b.end + offset);
            news.push(cloneBlock(b, { rowId, start, end }));
          }
          if (news.length === 0) return;
          mutate(
            { blocks: [...core.blocks, ...news] },
            `Paste ${news.length} ${news.length === 1 ? 'block' : 'blocks'}`,
          );
          set({ selection: news.map((b) => b.id) });
        },

        duplicateSelection: () => {
          const sel = new Set(get().selection);
          if (sel.size === 0) return;
          const { core } = get();
          const rawBeat = beatLen(core.grid);
          const beat = Number.isFinite(rawBeat) && rawBeat > 0 ? rawBeat : 0.5;
          const news: Block[] = [];
          for (const b of core.blocks) {
            if (!sel.has(b.id)) continue;
            // "Directly after": a ranged copy butts onto the original's end; a point copy lands a beat later.
            const offset = b.isPoint ? beat : b.end - b.start;
            news.push(cloneBlock(b, { start: b.start + offset, end: b.end + offset }));
          }
          if (news.length === 0) return;
          mutate(
            { blocks: [...core.blocks, ...news] },
            `Duplicate ${news.length} ${news.length === 1 ? 'block' : 'blocks'}`,
          );
          set({ selection: news.map((b) => b.id) });
        },

        // ── commands ─────────────────────────────────────────────────────
        resnapAllToGrid: () => {
          const grid = get().core.grid;
          // Pull everything onto the selected grid division (bar if grid snapping is off).
          // This is a deliberate grid re-quantise, so cue-magnet snapping doesn't apply here.
          const res = get().view.snap.grid ?? 'bar';
          mutate({
            blocks: get().core.blocks.map((b) => {
              const start = snapTime(b.start, grid, res);
              if (b.isPoint) return { ...b, start, end: start };
              const end = Math.max(start, snapTime(b.end, grid, res));
              return { ...b, start, end };
            }),
          }, 'Re-snap to grid');
        },

        // ── detection ────────────────────────────────────────────────────
        setDetection: (state) => set({ detection: state }),
        applyDetection: (bpm, offset) =>
          mutate(
            {
              grid: {
                ...get().core.grid,
                bpm,
                ...(offset !== undefined ? { offset } : {}),
              },
            },
            `Apply ${bpm} BPM`,
          ),
      };
    },
    {
      // Only `core` is tracked for undo/redo (spec: view/playback/selection excluded).
      // `historyLabel` rides along so each snapshot is self-describing and the label travels
      // with undo/redo; `equality` stays on `core` only (a label only changes with `core`).
      partialize: (state): { core: ProjectCore; historyLabel: string } => ({
        core: state.core,
        historyLabel: state.historyLabel,
      }),
      limit: HISTORY_LIMIT,
      equality: (a, b) => a.core === b.core,
    },
  ),
);

/** One zundo history snapshot: the partialized `{ core, historyLabel }`. */
export interface HistoryEntry {
  core: ProjectCore;
  historyLabel: string;
}

// Late-bound self reference so actions can reach the temporal store.
const store = useStore as typeof useStore & {
  temporal: StoreApi<{
    pastStates: HistoryEntry[];
    futureStates: HistoryEntry[];
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
export function beginHistoryGroup(label: string): void {
  const t = store.temporal.getState();
  // Snapshot the PRE-gesture state with its existing label (keeps that history row
  // self-describing), then stamp the live label for the state this gesture will produce.
  const cur = useStore.getState();
  const snapshot: HistoryEntry = { core: cur.core, historyLabel: cur.historyLabel };
  store.temporal.setState((s) => {
    // Enforce the same cap zundo applies in its internal _handleSet, since this manual
    // push bypasses it (otherwise grouped gestures would grow history without bound).
    const past =
      s.pastStates.length >= HISTORY_LIMIT
        ? s.pastStates.slice(s.pastStates.length - HISTORY_LIMIT + 1)
        : s.pastStates;
    return { pastStates: [...past, snapshot], futureStates: [] };
  });
  useStore.setState({ historyLabel: label });
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

export function undo(steps = 1): void {
  store.temporal.getState().undo(steps);
}
export function redo(steps = 1): void {
  store.temporal.getState().redo(steps);
}
export function clearHistory(): void {
  store.temporal.getState().clear();
}
export const temporalStore = store.temporal;

// ── helpers (pure) ──────────────────────────────────────────────────────────

/** Content-duration over the current state (the pure helper lives in core/contentExtent). */
function contentDurationOf(s: StoreState): number {
  return contentDuration(s.core.audio, s.core.blocks);
}

function barSpan(grid: BeatGrid): number {
  const len = (60 / grid.bpm) * grid.beatsPerBar;
  return Number.isFinite(len) && len > 0 ? len : 1;
}

function normalizeBlock(b: Block): Block {
  // Keep curve points ordered, clamped and endpoint-pinned no matter which path mutated them.
  const base = b.curve ? { ...b, curve: { ...b.curve, points: normalizePoints(b.curve.points) } } : b;
  if (base.isPoint) return { ...base, end: base.start };
  // A zero- (or negative-) duration ranged cue collapses to a milestone marker.
  if (base.end <= base.start) return { ...base, isPoint: true, end: base.start };
  return base;
}

/**
 * Apply a transform to a block's curve and write it back (normalized). No-op when the block
 * is missing or has no curve. Used by the curve point/type/shape actions.
 */
function updateCurveBlock(
  get: () => StoreState,
  mutate: (changes: Partial<ProjectCore>, label?: string) => void,
  id: string,
  fn: (c: CurveData) => CurveData,
  label?: string,
): void {
  mutate(
    {
      blocks: get().core.blocks.map((b) =>
        b.id === id && b.curve ? normalizeBlock({ ...b, curve: fn(b.curve) }) : b,
      ),
    },
    label,
  );
}


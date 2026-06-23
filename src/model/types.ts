// Canonical data model (spec §4). All canonical times are in SECONDS (Float).
// See spec §5.2 for why seconds — not bars — are the canonical unit.

export type RowKind = 'track' | 'section' | 'cue' | 'group';

/**
 * A grid subdivision used by {@link snapTime}/{@link snapStep}. `off` is a legacy value kept
 * for those low-level grid helpers; the editor's grid snapping now uses {@link GridSnap}.
 */
export type SnapResolution = 'bar' | 'half' | 'quarter' | 'eighth' | 'off';

/** The four grid divisions a single-select grid snap can use (a subset of SnapResolution). */
export type GridSnap = 'bar' | 'half' | 'quarter' | 'eighth';

/**
 * Which snap targets are active while creating/moving/resizing cues (spec §12).
 *
 *  - `enabled` is the master switch: when false NOTHING snaps (equivalent to the old
 *    `snap: 'off'`), regardless of the other fields.
 *  - `cues` (independent toggle) snaps a dragged edge to the start/end of OTHER cues — a
 *    screen-space magnet, so it aligns cues across tracks.
 *  - `grid` is a SINGLE grid division to quantise to, or `null` for no grid snapping. It's
 *    single-select because a finer division already covers the coarser ones' lines.
 *
 * Holding Alt during a gesture bypasses all of this regardless of the settings.
 */
export interface SnapSettings {
  enabled: boolean;
  cues: boolean;
  grid: GridSnap | null;
}

export interface BeatGrid {
  bpm: number; // > 0, constant
  offset: number; // seconds; time of bar 1, beat 1 (the downbeat anchor)
  beatsPerBar: number; // time-signature numerator (default 4)
  beatUnit: number; // time-signature denominator (default 4)
}

export interface Row {
  id: string; // uuid
  kind: RowKind; // 'track'/'section' always present & not deletable; 'group' = a folder
  name: string; // editable; for 'track' this is the audio track name; for 'group' the folder name
  icon: string; // lucide icon name (track/section/group get sensible defaults)
  color: string; // hex, e.g. "#7C5CFF"
  /**
   * Sibling order WITHIN `parentId` (not a global position). Track is pinned to
   * parentId=null/order=0 and section to parentId=null/order=1; every other top-level
   * node uses order >= 2. Nested children use sequential sibling order within their group.
   */
  order: number;
  /** Containing group's id, or null for a top-level row. Only 'cue'/'group' may be nested. */
  parentId: string | null;
  /** Groups only: whether the folder is collapsed (its descendants are hidden). */
  collapsed?: boolean;
  /** Free-text "prep cue": the state this row should be in before the scene starts. */
  prepCue?: string;
}

/** Whether a cue presents as free text or as an envelope curve. Absent ⇒ 'text'. */
export type CueMode = 'text' | 'curve';

/**
 * Canonical curve presets the user can pick from the type buttons (spec: curve types).
 * `trapezium` is an attack/sustain/release shape (rise, flat hold, fall) with two movable
 * "shoulder" points.
 */
export type CurveType = 'ascending' | 'descending' | 'peak' | 'trapezium' | 'arbitrary';

/**
 * Easing applied to the segment LEAVING a point (toward the next one). The LAST point's
 * shape is inert (no segment leaves it). Default 'linear'.
 *  - exp: ease-in (slow start), log: ease-out (fast start, the "square root" shape),
 *    scurve: smooth ease-in-out, step: hold then jump (square).
 */
export type SegmentShape = 'linear' | 'exp' | 'log' | 'scurve' | 'step';

/**
 * One control point of a curve envelope.
 *  - `t`: normalized position along the block span, 0..1 (0 = block.start, 1 = block.end).
 *  - `v`: normalized envelope value, 0..1 (0 = bottom, 1 = top). Abstract — no units.
 *  - `shape`: easing of the segment leaving this point toward the next (inert on the last).
 */
export interface CurvePoint {
  t: number; // 0..1
  v: number; // 0..1
  shape: SegmentShape;
}

/** Curve presentation data for a cue. Ordered by `t`; >= 2 points; first.t === 0, last.t === 1. */
export interface CurveData {
  type: CurveType;
  points: CurvePoint[];
}

export interface Block {
  id: string; // uuid
  rowId: string;
  start: number; // seconds
  end: number; // seconds; for a point cue, end === start
  isPoint: boolean; // true => rendered as a marker, zero length
  label: string; // free text (preserved even in curve mode)
  /** Presentation mode. Absent ⇒ 'text'; curve mode iff mode === 'curve'. */
  mode?: CueMode;
  /** Envelope data, retained even in text mode so re-toggling restores it. */
  curve?: CurveData;
}

export interface AudioMeta {
  fileName: string;
  mimeType: string;
  sampleRate: number;
  duration: number; // seconds
  channels: number;
  hash: string; // content hash; key for cached audio blob in IndexedDB
}

export interface ViewState {
  pixelsPerSecond: number; // zoom
  scrollSec: number; // left edge of viewport, in seconds
  snap: SnapSettings;
  followPlayhead: boolean;
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  audio: AudioMeta | null;
  grid: BeatGrid;
  rows: Row[]; // includes the two fixed rows
  blocks: Block[];
  view: ViewState;
  updatedAt: number; // epoch ms
}

/**
 * In the store, `view` is kept as a sibling slice (not nested in the project)
 * so that undo/redo (zundo) tracks only canonical content — block/row/grid edits —
 * and never zoom/scroll/snap changes. The full {@link Project} (with `view` merged
 * back in) is reconstructed only at export/persist time.
 */
export type ProjectCore = Omit<Project, 'view'>;

export const SCHEMA_VERSION = 1 as const;

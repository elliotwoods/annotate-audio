// Canonical data model (spec §4). All canonical times are in SECONDS (Float).
// See spec §5.2 for why seconds — not bars — are the canonical unit.

export type RowKind = 'track' | 'section' | 'cue';

export type SnapResolution = 'bar' | 'half' | 'quarter' | 'eighth' | 'off';

export interface BeatGrid {
  bpm: number; // > 0, constant
  offset: number; // seconds; time of bar 1, beat 1 (the downbeat anchor)
  beatsPerBar: number; // time-signature numerator (default 4)
  beatUnit: number; // time-signature denominator (default 4)
}

export interface Row {
  id: string; // uuid
  kind: RowKind; // 'track' and 'section' rows always present, not deletable
  name: string; // editable; for 'track' this is the audio track name
  icon: string; // lucide icon name (track/section get sensible defaults)
  color: string; // hex, e.g. "#7C5CFF"
  order: number; // vertical position; track=0, section=1 enforced
}

export interface Block {
  id: string; // uuid
  rowId: string;
  start: number; // seconds
  end: number; // seconds; for a point cue, end === start
  isPoint: boolean; // true => rendered as a marker, zero length
  label: string; // free text
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
  snap: SnapResolution;
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

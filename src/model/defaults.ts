// Factory functions and constants for fresh projects, rows, and blocks (spec §4).

import { uuid } from '../core/ids';
import type { BeatGrid, Block, Project, ProjectCore, Row, SnapSettings, ViewState } from './types';
import { SCHEMA_VERSION } from './types';

export const DEFAULT_BPM = 120;

export const DEFAULT_GRID: BeatGrid = {
  bpm: DEFAULT_BPM,
  offset: 0,
  beatsPerBar: 4,
  beatUnit: 4,
};

/** Snapping on out of the box: align to other cues and to bar lines. */
export const DEFAULT_SNAP: SnapSettings = {
  enabled: true,
  cues: true,
  grid: 'bar',
};

export const DEFAULT_VIEW: ViewState = {
  pixelsPerSecond: 80,
  scrollSec: 0,
  snap: { ...DEFAULT_SNAP },
  followPlayhead: true,
};

// Default cue-row palette — distinct, readable on the dark theme.
export const ROW_PALETTE = [
  '#7C5CFF', // violet
  '#36D399', // green
  '#F472B6', // pink
  '#FBBF24', // amber
  '#38BDF8', // sky
  '#FB7185', // rose
  '#A3E635', // lime
  '#C084FC', // purple
  '#2DD4BF', // teal
  '#FB923C', // orange
];

export const DEFAULT_CUE_ICON = 'circle';
export const TRACK_ICON = 'audio-lines';
export const SECTION_ICON = 'bookmark';
export const GROUP_ICON = 'folder';

export const TRACK_COLOR = '#5B6172';
export const SECTION_COLOR = '#94A3B8';
export const GROUP_COLOR = '#8B93A7';

export function makeTrackRow(name = 'Track'): Row {
  return {
    id: uuid(),
    kind: 'track',
    name,
    icon: TRACK_ICON,
    color: TRACK_COLOR,
    order: 0,
    parentId: null,
  };
}

export function makeSectionRow(): Row {
  return {
    id: uuid(),
    kind: 'section',
    name: 'Section',
    icon: SECTION_ICON,
    color: SECTION_COLOR,
    order: 1,
    parentId: null,
  };
}

export function makeCueRow(order: number, index = 0, parentId: string | null = null): Row {
  return {
    id: uuid(),
    kind: 'cue',
    name: `Cue ${order - 1}`,
    icon: DEFAULT_CUE_ICON,
    color: ROW_PALETTE[index % ROW_PALETTE.length],
    order,
    parentId,
  };
}

export function makeGroupRow(order: number, index = 0, parentId: string | null = null): Row {
  return {
    id: uuid(),
    kind: 'group',
    name: 'Group',
    icon: GROUP_ICON,
    color: ROW_PALETTE[index % ROW_PALETTE.length],
    order,
    parentId,
    collapsed: false,
  };
}

export function makeBlock(rowId: string, start: number, end: number, label = ''): Block {
  const isPoint = end <= start;
  return {
    id: uuid(),
    rowId,
    start,
    end: isPoint ? start : end,
    isPoint,
    label,
  };
}

/**
 * Copy a block with a fresh id, deep-cloning its curve so the copy and original never share
 * point arrays. `patch` overrides any fields (e.g. rowId / start / end) on the clone. Used by
 * copy/paste and duplicate.
 */
export function cloneBlock(b: Block, patch: Partial<Block> = {}): Block {
  const curve = b.curve ? { type: b.curve.type, points: b.curve.points.map((p) => ({ ...p })) } : undefined;
  return { ...b, curve, ...patch, id: uuid() };
}

/** A fresh project: the two fixed rows, one empty cue row, default grid, no audio. */
export function makeProject(name = 'Untitled Show'): Project {
  const track = makeTrackRow();
  const section = makeSectionRow();
  const cue = makeCueRow(2, 0);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uuid(),
    name,
    audio: null,
    grid: { ...DEFAULT_GRID },
    rows: [track, section, cue],
    blocks: [],
    view: { ...DEFAULT_VIEW, snap: { ...DEFAULT_SNAP } },
    updatedAt: 0, // stamped by the store/persistence layer (avoid Date in pure factories)
  };
}

/** Split a full Project into the store's core slice + view slice. */
export function splitProject(p: Project): { core: ProjectCore; view: ViewState } {
  const { view, ...core } = p;
  return { core, view };
}

/** Reassemble a full Project from the store's core + view slices. */
export function joinProject(core: ProjectCore, view: ViewState): Project {
  return { ...core, view };
}

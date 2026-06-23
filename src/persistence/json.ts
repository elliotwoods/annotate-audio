// JSON project export/import (spec §13.1).
//
// Export: serialize a Project to pretty JSON and trigger a `<name>.cuetl.json` download.
// Import: read the file text, JSON.parse, then defensively validate + normalize into a
// Project. The JSON deliberately does NOT contain audio data — only `audio` metadata
// (AudioMeta) referencing a content hash; rehydration of the blob happens elsewhere.

import type {
  AudioMeta,
  BeatGrid,
  Block,
  CueMode,
  CurveData,
  CurvePoint,
  CurveType,
  GridSnap,
  Project,
  Row,
  RowKind,
  SegmentShape,
  SnapResolution,
  SnapSettings,
  ViewState,
} from '../model/types';
import { SCHEMA_VERSION } from '../model/types';
import { DEFAULT_SNAP } from '../model/defaults';
import { normalizeTree } from '../core/rowtree';
import { clamp01, defaultPointsFor, normalizePoints } from '../core/curve';

const FILE_EXTENSION = '.cuetl.json';

/** Turn an arbitrary project name into a filesystem-friendly base name. */
function sanitizeName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^a-z0-9_\- ]+/gi, '') // drop characters unsafe/awkward in filenames
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned : 'project';
}

/** Serialize a Project to a pretty JSON Blob and trigger a browser download. */
export function exportProjectToFile(p: Project): void {
  const json = JSON.stringify(p, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeName(p.name) + FILE_EXTENSION;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Read a file, parse JSON, validate + normalize into a Project. Rejects on invalid input. */
export async function importProjectFromFile(file: File): Promise<Project> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Invalid project file: not valid JSON.');
  }
  return validateProject(parsed);
}

// ── validation helpers ─────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string') {
    throw new Error(`Invalid project: "${key}" must be a string.`);
  }
  return v;
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid project: "${label}" must be a finite number.`);
  }
  return value;
}

function validateGrid(value: unknown): BeatGrid {
  if (!isRecord(value)) throw new Error('Invalid project: "grid" must be an object.');
  return {
    bpm: requireFiniteNumber(value.bpm, 'grid.bpm'),
    offset: requireFiniteNumber(value.offset, 'grid.offset'),
    beatsPerBar: requireFiniteNumber(value.beatsPerBar, 'grid.beatsPerBar'),
    beatUnit: requireFiniteNumber(value.beatUnit, 'grid.beatUnit'),
  };
}

const ROW_KINDS: readonly RowKind[] = ['track', 'section', 'cue', 'group'];

function validateRow(value: unknown, index: number): Row {
  if (!isRecord(value)) throw new Error(`Invalid project: rows[${index}] must be an object.`);
  const kind = value.kind;
  if (typeof kind !== 'string' || !ROW_KINDS.includes(kind as RowKind)) {
    throw new Error(
      `Invalid project: rows[${index}].kind must be 'track' | 'section' | 'cue' | 'group'.`,
    );
  }
  // Back-fill the tree fields for projects saved before groups existed.
  const parentId = typeof value.parentId === 'string' ? value.parentId : null;
  const row: Row = {
    id: requireString(value, 'id'),
    kind: kind as RowKind,
    name: requireString(value, 'name'),
    icon: requireString(value, 'icon'),
    color: requireString(value, 'color'),
    order: requireFiniteNumber(value.order, `rows[${index}].order`),
    parentId,
  };
  if (kind === 'group') row.collapsed = Boolean(value.collapsed);
  if (typeof value.prepCue === 'string') row.prepCue = value.prepCue;
  return row;
}

function validateRows(value: unknown): Row[] {
  if (!Array.isArray(value)) throw new Error('Invalid project: "rows" must be an array.');
  const rows = value.map((r, i) => validateRow(r, i));
  const trackCount = rows.filter((r) => r.kind === 'track').length;
  const sectionCount = rows.filter((r) => r.kind === 'section').length;
  if (trackCount !== 1) {
    throw new Error(`Invalid project: expected exactly one 'track' row, found ${trackCount}.`);
  }
  if (sectionCount !== 1) {
    throw new Error(`Invalid project: expected exactly one 'section' row, found ${sectionCount}.`);
  }
  // Re-enforce the full tree shape (pin track/section, per-parent order, repair dangling
  // parents, break cycles) — lenient, matching the existing order-normalization on import.
  return normalizeTree(rows);
}

const CUE_MODES: readonly CueMode[] = ['text', 'curve'];
const CURVE_TYPES: readonly CurveType[] = ['ascending', 'descending', 'peak', 'trapezium', 'arbitrary'];
const SEGMENT_SHAPES: readonly SegmentShape[] = ['linear', 'exp', 'log', 'scurve', 'step'];

/** Validate/repair a curve into a always-valid CurveData (>= 2 ordered, endpoint-pinned points). */
function validateCurve(value: unknown): CurveData | undefined {
  if (!isRecord(value)) return undefined;
  const type = CURVE_TYPES.includes(value.type as CurveType) ? (value.type as CurveType) : 'ascending';
  const raw = Array.isArray(value.points) ? value.points : [];
  let points: CurvePoint[] = raw.filter(isRecord).map((p) => ({
    t: clamp01(typeof p.t === 'number' ? p.t : 0),
    v: clamp01(typeof p.v === 'number' ? p.v : 0),
    shape: SEGMENT_SHAPES.includes(p.shape as SegmentShape) ? (p.shape as SegmentShape) : 'linear',
  }));
  if (points.length < 2) points = defaultPointsFor(type); // repair: never fewer than two
  return { type, points: normalizePoints(points) };
}

function validateBlock(value: unknown, index: number): Block {
  if (!isRecord(value)) throw new Error(`Invalid project: blocks[${index}] must be an object.`);
  const start = requireFiniteNumber(value.start, `blocks[${index}].start`);
  const end = requireFiniteNumber(value.end, `blocks[${index}].end`);
  const isPoint = typeof value.isPoint === 'boolean' ? value.isPoint : end <= start;
  const curve = validateCurve(value.curve);
  const block: Block = {
    id: requireString(value, 'id'),
    rowId: requireString(value, 'rowId'),
    start,
    end: isPoint ? start : Math.max(start, end),
    isPoint,
    label: typeof value.label === 'string' ? value.label : '',
  };
  // Only attach mode/curve when present, so legacy/text cues stay clean.
  if (CUE_MODES.includes(value.mode as CueMode)) block.mode = value.mode as CueMode;
  if (curve) block.curve = curve;
  return block;
}

function validateBlocks(value: unknown): Block[] {
  if (!Array.isArray(value)) throw new Error('Invalid project: "blocks" must be an array.');
  return value.map((b, i) => validateBlock(b, i));
}

const LEGACY_SNAP_RESOLUTIONS: readonly SnapResolution[] = ['bar', 'half', 'quarter', 'eighth', 'off'];
const GRID_SNAPS: readonly GridSnap[] = ['bar', 'half', 'quarter', 'eighth'];

/** Resolve the single grid division from an object's `grid` field (or older boolean flags). */
function pickGrid(raw: Record<string, unknown>): GridSnap | null {
  if (typeof raw.grid === 'string' && GRID_SNAPS.includes(raw.grid as GridSnap)) {
    return raw.grid as GridSnap;
  }
  if (raw.grid === null) return null;
  // Tolerate the short-lived boolean-per-division object shape (finest wins).
  if (raw.eighth) return 'eighth';
  if (raw.quarter) return 'quarter';
  if (raw.half) return 'half';
  if (raw.bar) return 'bar';
  return null;
}

/**
 * Normalize `view.snap` into {@link SnapSettings}, accepting the current object form or a
 * legacy single `SnapResolution` string (pre-toggles projects). A legacy 'off' becomes the
 * master toggle off (remembering 'bar'); any other legacy value enables snapping, that grid
 * division, and cue snapping. Missing/garbage → defaults.
 */
function normalizeSnap(raw: unknown): SnapSettings {
  if (typeof raw === 'string' && LEGACY_SNAP_RESOLUTIONS.includes(raw as SnapResolution)) {
    const enabled = raw !== 'off';
    return { enabled, cues: enabled, grid: raw === 'off' ? 'bar' : (raw as GridSnap) };
  }
  if (isRecord(raw)) {
    return {
      enabled: raw.enabled !== false, // default to on when omitted
      cues: Boolean(raw.cues),
      grid: pickGrid(raw),
    };
  }
  return { ...DEFAULT_SNAP };
}

function validateView(value: unknown): ViewState {
  if (!isRecord(value)) throw new Error('Invalid project: "view" must be an object.');
  return {
    pixelsPerSecond: requireFiniteNumber(value.pixelsPerSecond, 'view.pixelsPerSecond'),
    scrollSec: requireFiniteNumber(value.scrollSec, 'view.scrollSec'),
    snap: normalizeSnap(value.snap),
    followPlayhead: Boolean(value.followPlayhead),
  };
}

function validateAudio(value: unknown): AudioMeta | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) throw new Error('Invalid project: "audio" must be an object or null.');
  return {
    fileName: requireString(value, 'fileName'),
    mimeType: requireString(value, 'mimeType'),
    sampleRate: requireFiniteNumber(value.sampleRate, 'audio.sampleRate'),
    duration: requireFiniteNumber(value.duration, 'audio.duration'),
    channels: requireFiniteNumber(value.channels, 'audio.channels'),
    hash: requireString(value, 'hash'),
  };
}

/**
 * Defensively validate an arbitrary parsed value into a normalized Project. Throws an
 * Error with a specific message if the structure is invalid. Performs schema migration
 * if needed — only schemaVersion 1 exists today.
 */
export function validateProject(obj: unknown): Project {
  if (!isRecord(obj)) {
    throw new Error('Invalid project: expected a JSON object.');
  }

  const rawVersion = obj.schemaVersion;
  if (rawVersion === undefined || rawVersion === null) {
    throw new Error('Invalid project: missing "schemaVersion".');
  }
  if (rawVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Unsupported project schemaVersion ${String(rawVersion)} (this build supports ${SCHEMA_VERSION}).`,
    );
  }

  const project: Project = {
    schemaVersion: SCHEMA_VERSION,
    id: requireString(obj, 'id'),
    name: requireString(obj, 'name'),
    audio: validateAudio(obj.audio),
    grid: validateGrid(obj.grid),
    rows: validateRows(obj.rows),
    blocks: validateBlocks(obj.blocks),
    view: validateView(obj.view),
    updatedAt:
      typeof obj.updatedAt === 'number' && Number.isFinite(obj.updatedAt) ? obj.updatedAt : Date.now(),
  };

  // Guard the row-integrity invariant: blocks must reference an existing row.
  const rowIds = new Set(project.rows.map((r) => r.id));
  for (const b of project.blocks) {
    if (!rowIds.has(b.rowId)) {
      throw new Error(`Invalid project: block "${b.id}" references missing row "${b.rowId}".`);
    }
  }

  return project;
}

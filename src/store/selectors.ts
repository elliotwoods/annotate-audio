// Convenience selector hooks over the single store. Components subscribe to the
// narrowest slice they need so unrelated mutations don't re-render them.

import { useMemo } from 'react';
import { useStore } from './store';
import type { StoreState } from './store';
import type { Block, Row } from '../model/types';
import { flattenRows, type VisibleRow } from '../core/rowtree';
import { contentDuration } from '../core/contentExtent';

export const useView = () => useStore((s) => s.view);
export const useGrid = () => useStore((s) => s.core.grid);
export const useAudio = () => useStore((s) => s.core.audio);
export const useProjectName = () => useStore((s) => s.core.name);
export const useProjectId = () => useStore((s) => s.core.id);
export const useSelection = () => useStore((s) => s.selection);
/** Whether the project has content worth sharing (audio loaded or ≥1 block). Drives auto-publish
 *  of a local set so its URL becomes a live edit link — mirror of `worthPublishing` in shareUrl.ts. */
export const useHasShareableContent = () =>
  useStore((s) => !!s.core.audio || s.core.blocks.length > 0);
export const useIsPlaying = () => useStore((s) => s.playback.isPlaying);
export const useDetection = () => useStore((s) => s.detection);
export const useSnap = () => useStore((s) => s.view.snap);
export const useSnapIndicator = () => useStore((s) => s.snapIndicator);

/** All rows sorted by `order` (flat — does not account for the group tree). */
export function useSortedRows(): Row[] {
  const rows = useStore((s) => s.core.rows);
  return useMemo(() => [...rows].sort((a, b) => a.order - b.order), [rows]);
}

/**
 * Rows in display order (depth-first through the group tree, descendants of collapsed
 * groups omitted), each with its nesting `depth`. This is what the lane list renders.
 */
export function useVisibleRows(): VisibleRow[] {
  const rows = useStore((s) => s.core.rows);
  return useMemo(() => flattenRows(rows), [rows]);
}

export function useRow(rowId: string): Row | undefined {
  return useStore((s) => s.core.rows.find((r) => r.id === rowId));
}

/** Blocks belonging to a single row (stable-ish reference via memo on the array). */
export function useBlocksByRow(rowId: string): Block[] {
  const blocks = useStore((s) => s.core.blocks);
  return useMemo(() => blocks.filter((b) => b.rowId === rowId), [blocks, rowId]);
}

export const useAllBlocks = () => useStore((s) => s.core.blocks);

/** Section-row block START times, sorted — the targets for quantised section jumps. */
export function useSectionBoundaries(): number[] {
  const rows = useStore((s) => s.core.rows);
  const blocks = useStore((s) => s.core.blocks);
  return useMemo(() => {
    const sectionRow = rows.find((r) => r.kind === 'section');
    if (!sectionRow) return [];
    return blocks
      .filter((b) => b.rowId === sectionRow.id)
      .map((b) => b.start)
      .sort((a, b) => a - b);
  }, [rows, blocks]);
}

/**
 * Effective content duration in seconds: the furthest of the audio end and the
 * furthest cue end (cues can sit past the clip), else a sensible default. Used for
 * fit-to-window, scroll clamping and the scrollbar. See {@link contentDuration}.
 */
export function getContentDuration(s: StoreState): number {
  return contentDuration(s.core.audio, s.core.blocks);
}

export function useContentDuration(): number {
  return useStore(getContentDuration);
}

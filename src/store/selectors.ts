// Convenience selector hooks over the single store. Components subscribe to the
// narrowest slice they need so unrelated mutations don't re-render them.

import { useMemo } from 'react';
import { useStore } from './store';
import type { StoreState } from './store';
import type { Block, Row } from '../model/types';

export const useView = () => useStore((s) => s.view);
export const useGrid = () => useStore((s) => s.core.grid);
export const useAudio = () => useStore((s) => s.core.audio);
export const useProjectName = () => useStore((s) => s.core.name);
export const useProjectId = () => useStore((s) => s.core.id);
export const useSelection = () => useStore((s) => s.selection);
export const useIsPlaying = () => useStore((s) => s.playback.isPlaying);
export const useDetection = () => useStore((s) => s.detection);
export const useSnap = () => useStore((s) => s.view.snap);

/** All rows sorted by `order` (track=0, section=1, cue rows >= 2). */
export function useSortedRows(): Row[] {
  const rows = useStore((s) => s.core.rows);
  return useMemo(() => [...rows].sort((a, b) => a.order - b.order), [rows]);
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
 * Effective content duration in seconds: audio duration if loaded, else the furthest
 * block end, else a sensible default. Used for fit-to-window and scroll clamping.
 */
export function getContentDuration(s: StoreState): number {
  if (s.core.audio) return s.core.audio.duration;
  const maxEnd = s.core.blocks.reduce((m, b) => Math.max(m, b.end), 0);
  return maxEnd > 0 ? maxEnd : 60;
}

export function useContentDuration(): number {
  return useStore(getContentDuration);
}

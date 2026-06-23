// Numeric layout metrics. MUST stay in sync with the matching tokens in src/index.css
// (canvases need numbers; CSS needs the var()). Kept here as the single TS source.

import type { Block } from '../model/types';

export const GUTTER_W = 192; // --gutter-w
export const RULER_H = 24; // bars/beats ruler row
export const TIME_RULER_H = 22; // time (mm:ss) ruler row
export const WAVEFORM_H = 96; // --waveform-h
export const ROW_H = 44; // --row-h (single-line base row height)

export const ROW_BASE_H = ROW_H; // height of a single-line row/block
export const ROW_LINE_H = 16; // extra height per additional label line
export const GROUP_INDENT = 15; // px of gutter indentation per nesting level

/** Number of text lines in a (possibly multi-line) label. */
export function labelLineCount(label: string): number {
  return label ? label.split('\n').length : 1;
}

/** Pixel height a block needs for its own label. */
export function blockHeightForLabel(label: string): number {
  return ROW_BASE_H + (labelLineCount(label) - 1) * ROW_LINE_H;
}

/** Pixel height a row needs = the tallest of its blocks' labels (min one line). */
export function rowHeightForLabels(labels: string[]): number {
  let h = ROW_BASE_H;
  for (const l of labels) h = Math.max(h, blockHeightForLabel(l));
  return h;
}

/** Fixed (taller) height a curve cue uses, to give the envelope room to be drawn/edited. */
export const CURVE_BLOCK_H = 72;

/** Pixel height a single block needs — curve cues use a fixed taller height; text uses its label. */
export function blockHeightForBlock(b: Block): number {
  return b.mode === 'curve' ? CURVE_BLOCK_H : blockHeightForLabel(b.label);
}

/** Pixel height a row needs = the tallest of its blocks (curve cues counted at CURVE_BLOCK_H). */
export function rowHeightForBlocks(blocks: Block[]): number {
  let h = ROW_BASE_H;
  for (const b of blocks) h = Math.max(h, blockHeightForBlock(b));
  return h;
}

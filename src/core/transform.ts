// The ONE coordinate transform (spec §5.1). Imported everywhere — ruler, waveform
// canvas, lane DOM, playhead. No view may compute its own mapping (spec §3).
//
//   timeToX(t, view) = (t - view.scrollSec) * view.pixelsPerSecond
//   xToTime(x, view) = view.scrollSec + x / view.pixelsPerSecond
//
// `x` is measured from the LEFT EDGE OF THE LANE AREA (i.e. just right of the fixed
// gutter), in CSS pixels. Callers subtract the gutter/lane offset before passing x in.

import type { ViewState } from '../model/types';

/** Just the fields the transform needs — lets callers pass a partial view. */
export interface Viewport {
  pixelsPerSecond: number;
  scrollSec: number;
}

export function timeToX(t: number, view: Viewport): number {
  return (t - view.scrollSec) * view.pixelsPerSecond;
}

export function xToTime(x: number, view: Viewport): number {
  return view.scrollSec + x / view.pixelsPerSecond;
}

/** Width in pixels of a duration (in seconds) at the current zoom. */
export function durationToWidth(seconds: number, view: Viewport): number {
  return seconds * view.pixelsPerSecond;
}

/** The time at the right edge of a viewport `widthPx` pixels wide. */
export function viewportEndSec(view: Viewport, widthPx: number): number {
  return view.scrollSec + widthPx / view.pixelsPerSecond;
}

/** The visible time window [start, end] for a viewport `widthPx` pixels wide. */
export function visibleRange(view: Viewport, widthPx: number): [number, number] {
  return [view.scrollSec, view.scrollSec + widthPx / view.pixelsPerSecond];
}

/**
 * Compute the scrollSec needed to keep a focal time fixed at a focal x while
 * changing zoom — used by zoom-in/out so the point under the cursor (or the
 * viewport centre) stays put.
 */
export function scrollForFocalZoom(
  focalTime: number,
  focalX: number,
  newPixelsPerSecond: number,
): number {
  // focalTime maps to focalX  =>  (focalTime - scroll) * pps = focalX
  return focalTime - focalX / newPixelsPerSecond;
}

/** Clamp scrollSec so the viewport stays within [0, duration] (with a little tail). */
export function clampScroll(
  scrollSec: number,
  view: Viewport,
  widthPx: number,
  duration: number,
): number {
  const windowSec = widthPx / view.pixelsPerSecond;
  // Allow scrolling a little past the end so the final block is reachable,
  // but never left of zero.
  const maxScroll = Math.max(0, duration - windowSec * 0.5);
  return Math.min(Math.max(0, scrollSec), maxScroll);
}

export type { ViewState };

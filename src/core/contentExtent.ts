// Single source of truth for "how far does the content reach" (spec §5.1 view math).
// Consumed by fit-to-window, scroll clamping and the horizontal scrollbar.

import type { AudioMeta, Block } from '../model/types';

/**
 * Effective content duration in seconds: the furthest of the audio end and the
 * furthest cue end, falling back to 60s for an empty project.
 *
 * Cues are NOT pinned to the audio: a cue can be created, moved or resized past the
 * end of the clip (its start is clamped to >= 0, its end is not). So "zoom to all",
 * zoom-out and scrolling must reach beyond `audio.duration` to those stray cues —
 * taking the max of both ends keeps them framable and reachable rather than clipped.
 */
export function contentDuration(audio: AudioMeta | null, blocks: Block[]): number {
  const maxBlockEnd = blocks.reduce((m, b) => Math.max(m, b.end), 0);
  const end = Math.max(audio?.duration ?? 0, maxBlockEnd);
  return end > 0 ? end : 60;
}

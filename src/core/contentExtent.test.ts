import { describe, it, expect } from 'vitest';
import { contentDuration } from './contentExtent';
import type { AudioMeta, Block } from '../model/types';

const audio = (duration: number): AudioMeta => ({
  fileName: 'a.wav',
  mimeType: 'audio/wav',
  sampleRate: 44100,
  duration,
  channels: 2,
  hash: 'x',
});

const block = (start: number, end: number): Block => ({
  id: `${start}-${end}`,
  rowId: 'r',
  start,
  end,
  isPoint: start === end,
  label: '',
});

describe('contentDuration', () => {
  it('falls back to 60s for an empty project', () => {
    expect(contentDuration(null, [])).toBe(60);
  });

  it('uses the furthest block end when there is no audio', () => {
    expect(contentDuration(null, [block(0, 12), block(20, 30)])).toBe(30);
  });

  it('uses the audio duration when all cues sit within the clip', () => {
    expect(contentDuration(audio(180), [block(10, 20), block(170, 175)])).toBe(180);
  });

  it('extends past the audio to reach a cue beyond the clip end', () => {
    // The point of the change: a cue dragged past the end must stay framable/reachable.
    expect(contentDuration(audio(180), [block(170, 200)])).toBe(200);
    expect(contentDuration(audio(180), [block(250, 250)])).toBe(250);
  });
});

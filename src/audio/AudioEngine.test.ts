import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioEngine } from './AudioEngine';

// The engine talks to Web Audio through `window.AudioContext`. The test environment is
// `node`, so we stand up a minimal fake whose `currentTime` we advance by hand — that clock
// is what `position()` derives from, so controlling it lets us drive playback deterministically.

class FakeParam {
  value = 1;
}

class FakeGain {
  gain = new FakeParam();
  connect(): void {}
  disconnect(): void {}
}

class FakeBufferSource {
  buffer: unknown = null;
  playbackRate = new FakeParam();
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect(): void {}
  disconnect(): void {}
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  currentTime = 0;
  state: 'running' | 'suspended' = 'running';
  destination = {};
  /** Every source created via createBufferSource — lets tests count silent-tail vs audio starts. */
  sources: FakeBufferSource[] = [];
  constructor() {
    FakeAudioContext.last = this;
  }
  createGain(): FakeGain {
    return new FakeGain();
  }
  createBufferSource(): FakeBufferSource {
    const s = new FakeBufferSource();
    this.sources.push(s);
    return s;
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  close(): void {}
}

function fakeBuffer(duration: number): AudioBuffer {
  return {
    duration,
    sampleRate: 44100,
    numberOfChannels: 1,
    length: Math.round(duration * 44100),
    getChannelData: () => new Float32Array(0),
  } as unknown as AudioBuffer;
}

beforeEach(() => {
  FakeAudioContext.last = null;
  (globalThis as unknown as { window: unknown }).window = { AudioContext: FakeAudioContext };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('AudioEngine playEnd (play/seek past the audio into the cue tail)', () => {
  let engine: AudioEngine;

  beforeEach(() => {
    engine = new AudioEngine();
    engine.setBuffer(fakeBuffer(30)); // 30s of audio
  });

  it('baselines playEnd to the audio length and never shrinks below it', () => {
    expect(engine.playbackEnd).toBe(30);
    engine.setPlayEnd(10); // a content extent shorter than the clip is impossible
    expect(engine.playbackEnd).toBe(30);
    engine.setPlayEnd(45); // a cue reaching 45s pushes the playable end out
    expect(engine.playbackEnd).toBe(45);
  });

  it('advances the playhead through the silent tail and clamps to playEnd', async () => {
    engine.setPlayEnd(45);
    await engine.play(0);
    const ctx = FakeAudioContext.last!;

    ctx.currentTime = 20;
    expect(engine.position()).toBeCloseTo(20); // within the audio

    ctx.currentTime = 40;
    expect(engine.position()).toBeCloseTo(40); // past the audio (30), still within the tail

    ctx.currentTime = 60;
    expect(engine.position()).toBeCloseTo(45); // clamped to the last cue's end, not the buffer
  });

  it('starts no buffer source when playback begins in the silent tail', async () => {
    engine.setPlayEnd(45);
    await engine.play(0);
    const ctx = FakeAudioContext.last!;
    expect(ctx.sources.length).toBe(1); // audio source for the [0,30) region

    ctx.currentTime = 5;
    engine.seek(40); // seek into the tail while playing
    expect(ctx.sources.length).toBe(1); // no new source — the tail is silent
    expect(engine.isPlaying).toBe(true);

    ctx.currentTime = 8; // 3s after the seek anchor
    expect(engine.position()).toBeCloseTo(43);
  });

  it('starts an audio source again when seeking back from the tail into the clip', async () => {
    engine.setPlayEnd(45);
    await engine.play(40); // begin in the tail → no source
    const ctx = FakeAudioContext.last!;
    expect(ctx.sources.length).toBe(0);

    engine.seek(10); // back into the audio region
    expect(ctx.sources.length).toBe(1);
  });

  it('clamps a seek beyond the timeline to playEnd', () => {
    engine.setPlayEnd(45);
    engine.seek(100); // paused → freezes at the end
    expect(engine.position()).toBeCloseTo(45);
  });

  it('replays from the start when Play is pressed while parked at the end', async () => {
    engine.setPlayEnd(45);
    engine.seek(45); // parked at the timeline end (paused)
    expect(engine.position()).toBeCloseTo(45);

    await engine.play(); // no explicit offset → restart from 0
    expect(engine.position()).toBeCloseTo(0);
    expect(engine.isPlaying).toBe(true);
  });

  it('finishAtEnd freezes the transport at the last cue end', async () => {
    engine.setPlayEnd(45);
    await engine.play(0);
    engine.finishAtEnd();
    expect(engine.isPlaying).toBe(false);
    expect(engine.position()).toBeCloseTo(45);
  });

  it('behaves exactly as before when no cue extends past the audio', async () => {
    // playEnd stays at the buffer duration → position clamps at the audio end.
    expect(engine.playbackEnd).toBe(30);
    await engine.play(0);
    const ctx = FakeAudioContext.last!;
    ctx.currentTime = 100;
    expect(engine.position()).toBeCloseTo(30);
  });
});

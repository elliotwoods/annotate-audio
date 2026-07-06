// Web Audio playback engine (spec §8). Graph: AudioBufferSourceNode → GainNode → dest.
// Sources are one-shot; SEEK = stop current source + start a new one at the offset.
// Position is derived from the AudioContext clock (no drifting timers).

export class AudioDecodeError extends Error {
  constructor(
    message: string,
    readonly format: string,
  ) {
    super(message);
    this.name = 'AudioDecodeError';
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;

  private playing = false;
  /** ctx.currentTime at which the current source started. */
  private startedAtCtxTime = 0;
  /** buffer offset (seconds) the current source started from. */
  private startOffset = 0;
  /** frozen position while paused/stopped. */
  private frozenPosition = 0;
  private rate = 1;
  /**
   * End of the playable timeline in seconds. Defaults to the audio length but can be
   * pushed out to the furthest cue end (see Transport.syncPlayEnd) so the playhead can
   * seek/play through the silent tail past the audio, up to the last cue.
   */
  private playEnd = 0;

  /** Lazily create the AudioContext (must follow a user gesture in most browsers). */
  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  get audioContext(): AudioContext | null {
    return this.ctx;
  }

  get isLoaded(): boolean {
    return this.buffer !== null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  /** End of the playable timeline (>= audio length). */
  get playbackEnd(): number {
    return this.playEnd;
  }

  /**
   * Extend the playable end to `sec` (the content extent = furthest of audio end and
   * cue ends). Never shrinks below the audio length — the whole clip is always playable.
   */
  setPlayEnd(sec: number): void {
    this.playEnd = Math.max(sec, this.duration);
  }

  get sampleRate(): number {
    return this.buffer?.sampleRate ?? this.ctx?.sampleRate ?? 44100;
  }

  /**
   * Decode an audio file's bytes into the engine's buffer. Throws {@link AudioDecodeError}
   * with the format name on failure (spec §8.1 — clear, specific error, never silent).
   */
  async decode(data: ArrayBuffer, format: string): Promise<AudioBuffer> {
    const ctx = this.ensureCtx();
    try {
      // decodeAudioData detaches the ArrayBuffer in some engines — pass a copy so the
      // caller can still hash/cache the original bytes.
      const buf = await ctx.decodeAudioData(data.slice(0));
      this.setBuffer(buf);
      return buf;
    } catch (err) {
      throw new AudioDecodeError(
        `Could not decode "${format}". This browser may not support the codec, or the file is corrupt. ` +
          `Try a different format (FLAC/M4A are widely supported; OGG Vorbis is unsupported in Safari) or another browser.`,
        format,
      );
    }
  }

  /** Use an already-decoded buffer (e.g. rehydrated from cache). */
  setBuffer(buf: AudioBuffer): void {
    this.stop();
    this.buffer = buf;
    this.frozenPosition = 0;
    // Baseline the playable end to the audio; Transport widens it to include stray cues.
    this.playEnd = buf.duration;
  }

  /** Drop the current buffer and reset position — used when switching projects. */
  clear(): void {
    this.stop();
    this.buffer = null;
    this.frozenPosition = 0;
    this.playEnd = 0;
  }

  /** Channel data copies safe to transfer to a worker, plus the sample rate. */
  getChannelArrays(): { channels: Float32Array[]; sampleRate: number; length: number } {
    if (!this.buffer) return { channels: [], sampleRate: this.sampleRate, length: 0 };
    const channels: Float32Array[] = [];
    for (let c = 0; c < this.buffer.numberOfChannels; c++) {
      channels.push(this.buffer.getChannelData(c).slice());
    }
    return { channels, sampleRate: this.buffer.sampleRate, length: this.buffer.length };
  }

  /** Current playback position in seconds (drift-free). */
  position(): number {
    if (this.playing && this.ctx) {
      const pos = (this.ctx.currentTime - this.startedAtCtxTime) * this.rate + this.startOffset;
      // Clamp to the playable end (audio ∪ cues), not the buffer end — the clock keeps
      // advancing through the silent tail after the buffer source has finished.
      return Math.min(Math.max(0, pos), this.playEnd);
    }
    return this.frozenPosition;
  }

  setGain(value: number): void {
    if (this.gain) this.gain.gain.value = value;
  }

  setRate(rate: number): void {
    // Re-anchor the clock before changing rate while playing, otherwise position()
    // would retroactively rescale all elapsed time by the new rate and jump.
    if (this.playing && this.ctx) {
      this.startOffset = this.position();
      this.startedAtCtxTime = this.ctx.currentTime;
    }
    this.rate = rate;
    if (this.source) this.source.playbackRate.value = rate;
  }

  /** Start (or resume) playback from `offset` (defaults to current position). */
  async play(offset?: number): Promise<void> {
    if (!this.buffer) return;
    const ctx = this.ensureCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    let startAt = offset ?? this.position();
    // If we're parked at the end of the timeline and Play is pressed with no explicit
    // offset, replay from the start rather than starting at the end (which would stop
    // again on the next frame).
    if (offset === undefined && startAt >= this.playEnd - 1e-3) startAt = 0;
    this.beginPlayback(Math.min(Math.max(0, startAt), this.playEnd));
  }

  pause(): void {
    if (!this.playing) return;
    this.frozenPosition = this.position();
    this.teardownSource();
    this.playing = false;
  }

  /** Stop and reset to 0 (spec §18 default stop semantics). */
  stop(): void {
    this.teardownSource();
    this.playing = false;
    this.frozenPosition = 0;
  }

  /** Move the playhead. Restarts the source when playing; just freezes when paused. */
  seek(time: number): void {
    const t = Math.min(Math.max(0, time), this.playEnd);
    if (this.playing) {
      this.beginPlayback(t);
    } else {
      this.frozenPosition = t;
    }
  }

  /** Freeze the transport at the end of the timeline (called when the playhead reaches playEnd). */
  finishAtEnd(): void {
    this.teardownSource();
    this.playing = false;
    this.frozenPosition = this.playEnd;
  }

  private beginPlayback(offset: number): void {
    if (!this.ctx) return;
    this.teardownSource();
    // Only spin up a buffer source within the audio; past the audio end the timeline is
    // silent (cues only), so we just anchor the clock and let position() advance there.
    if (this.buffer && this.gain && offset < this.duration - 1e-9) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.playbackRate.value = this.rate;
      src.connect(this.gain);
      src.onended = () => {
        // Buffer finished (or we stopped it). Release the node; the clock keeps running
        // into the silent tail — end-of-timeline is detected by Transport's rAF loop.
        if (this.source === src) this.source = null;
      };
      src.start(0, offset);
      this.source = src;
    }
    this.startedAtCtxTime = this.ctx.currentTime;
    this.startOffset = offset;
    this.playing = true;
  }

  private teardownSource(): void {
    if (this.source) {
      const s = this.source;
      this.source = null; // null first so onended guard sees we're no longer live
      try {
        s.onended = null;
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
  }

  dispose(): void {
    this.stop();
    this.ctx?.close();
    this.ctx = null;
    this.gain = null;
    this.buffer = null;
  }
}

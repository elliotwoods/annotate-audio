// Transport singleton: owns the AudioEngine, the rAF clock, store mirroring,
// follow-playhead auto-scroll (spec §10/§11), and quantised jumps (spec §11).
//
// The LIVE playhead position is published to subscribers via onTick (rAF while
// playing) so the playhead overlay and time readout update without re-rendering
// React on every frame. The store only mirrors isPlaying + an anchor position.

import { AudioEngine } from './AudioEngine';
import { useStore } from '../store/store';
import { timeToX } from '../core/transform';
import { nextBar, prevBar } from '../core/grid';

export type TickListener = (pos: number, playing: boolean) => void;

/** A discrete transport action — broadcast for opt-in collaborative playback sync. */
export type TransportEvent = { kind: 'play' | 'pause' | 'seek' | 'stop'; pos: number };
export type TransportListener = (e: TransportEvent) => void;

class Transport {
  readonly engine = new AudioEngine();
  private listeners = new Set<TickListener>();
  private transportListeners = new Set<TransportListener>();
  private raf = 0;
  /** Desired output gain (0 = muted). Tracked here so it survives audio (re)loads. */
  private gainValue = 1;

  constructor() {
    this.engine.onEnded = () => {
      // Natural end → reflect stopped state at the end position.
      useStore.getState().setPlayback({ isPlaying: false, positionSec: this.engine.duration });
      this.stopLoop();
      this.notify();
    };
  }

  // ── subscriptions ────────────────────────────────────────────────────────
  onTick(cb: TickListener): () => void {
    this.listeners.add(cb);
    // push current state immediately so a freshly-mounted overlay positions itself
    cb(this.position(), this.engine.isPlaying);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    const pos = this.position();
    const playing = this.engine.isPlaying;
    for (const cb of this.listeners) cb(pos, playing);
  }

  /**
   * Subscribe to discrete transport actions (play/pause/seek/stop). Used by collaborative
   * playback sync; kept separate from onTick (which is the per-frame position stream).
   */
  onTransport(cb: TransportListener): () => void {
    this.transportListeners.add(cb);
    return () => this.transportListeners.delete(cb);
  }

  private emitTransport(kind: TransportEvent['kind']): void {
    const e: TransportEvent = { kind, pos: this.position() };
    for (const cb of this.transportListeners) cb(e);
  }

  // ── clock ──────────────────────────────────────────────────────────────────
  private loop = (): void => {
    this.applyFollow();
    this.notify();
    if (this.engine.isPlaying) {
      this.raf = requestAnimationFrame(this.loop);
    }
  };

  private startLoop(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }
  private stopLoop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // ── transport ──────────────────────────────────────────────────────────────
  position(): number {
    return this.engine.position();
  }
  get isPlaying(): boolean {
    return this.engine.isPlaying;
  }

  async play(): Promise<void> {
    if (!this.engine.isLoaded) return;
    // Re-apply the desired gain: the GainNode is (re)created on each audio load and defaults
    // to full volume, so a mute chosen before/while loading must be reasserted here.
    this.engine.setGain(this.gainValue);
    await this.engine.play();
    useStore.getState().setPlayback({ isPlaying: true, positionSec: this.position() });
    this.startLoop();
    this.notify();
    this.emitTransport('play');
  }

  pause(): void {
    this.engine.pause();
    useStore.getState().setPlayback({ isPlaying: false, positionSec: this.position() });
    this.stopLoop();
    this.notify();
    this.emitTransport('pause');
  }

  async togglePlay(): Promise<void> {
    if (this.engine.isPlaying) this.pause();
    else await this.play();
  }

  stop(): void {
    this.engine.stop();
    useStore.getState().setPlayback({ isPlaying: false, positionSec: 0 });
    this.stopLoop();
    this.notify();
    this.emitTransport('stop');
  }

  /** Free seek (no snap) — spec §8.2/§11: clicking ruler/waveform. */
  seek(time: number): void {
    this.engine.seek(time);
    useStore.getState().setPlayback({ positionSec: this.position() });
    this.notify();
    this.emitTransport('seek');
  }

  setRate(rate: number): void {
    this.engine.setRate(rate);
  }
  setGain(gain: number): void {
    this.gainValue = gain;
    this.engine.setGain(gain);
  }
  /** Current desired output gain (0 = muted). */
  getGain(): number {
    return this.gainValue;
  }

  // ── quantised jumps (spec §11) ─────────────────────────────────────────────
  jumpBar(dir: -1 | 1): void {
    const { core } = useStore.getState();
    const cur = this.position();
    const target = dir > 0 ? nextBar(cur, core.grid) : prevBar(cur, core.grid);
    this.seek(clamp(target, 0, this.engine.duration || target));
  }

  jumpSection(dir: -1 | 1): void {
    const cur = this.position();
    const bounds = sectionBoundaries();
    const eps = 1e-4;
    if (dir > 0) {
      const next = bounds.find((b) => b > cur + eps);
      if (next !== undefined) this.seek(next);
    } else {
      const prev = [...bounds].reverse().find((b) => b < cur - eps);
      this.seek(prev !== undefined ? prev : 0);
    }
  }

  jumpStart(): void {
    this.seek(0);
  }
  jumpEnd(): void {
    this.seek(this.engine.duration);
  }

  // ── follow-playhead auto-scroll ──────────────────────────────────────────────
  private applyFollow(): void {
    const s = useStore.getState();
    if (!s.view.followPlayhead || !this.engine.isPlaying) return;
    const pos = this.position();
    const x = timeToX(pos, s.view);
    const w = s.laneWidth;
    // Page when the playhead nears the right edge or runs off the left.
    if (x > w * 0.85 || x < 0) {
      const newScroll = Math.max(0, pos - (w * 0.15) / s.view.pixelsPerSecond);
      s.setScrollSec(newScroll);
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** Section-row block start times, sorted (the section-jump targets). */
function sectionBoundaries(): number[] {
  const { core } = useStore.getState();
  const sectionRow = core.rows.find((r) => r.kind === 'section');
  if (!sectionRow) return [];
  return core.blocks
    .filter((b) => b.rowId === sectionRow.id)
    .map((b) => b.start)
    .sort((a, b) => a - b);
}

export const transport = new Transport();

// Bottom transport bar (spec §11 / §14). Large hit targets, left-to-right:
//   Stop · Play/Pause · ◀Sec / Sec▶ · ◀Bar / Bar▶ · time readout
//   (bars:beats + mm:ss.mmm) · snap selector · zoom −/+/fit · follow toggle.
//
// The live position comes from the transport rAF clock via transport.onTick.
// We keep the latest position in a ref and only push it into React state at
// ~30fps so the bar doesn't re-render on every animation frame.

import { useEffect, useRef, useState } from 'react';
import {
  Square,
  Play,
  Pause,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  Crosshair,
} from 'lucide-react';
import { transport } from '../audio/transport';
import { useStore } from '../store/store';
import { useGrid, useIsPlaying, useSnap } from '../store/selectors';
import { formatBarsBeats, formatClock } from '../core/grid';
import type { SnapResolution } from '../model/types';
import './Transport.css';

const SNAP_OPTIONS: ReadonlyArray<{ value: SnapResolution; label: string }> = [
  { value: 'bar', label: 'Bar' },
  { value: 'half', label: '1/2' },
  { value: 'quarter', label: '1/4' },
  { value: 'eighth', label: '1/8' },
  { value: 'off', label: 'Off' },
];

// Minimum interval between React state updates for the readout (~30fps).
const READOUT_INTERVAL_MS = 1000 / 30;

export function Transport() {
  const grid = useGrid();
  const isPlaying = useIsPlaying();
  const snap = useSnap();
  const setSnap = useStore((s) => s.setSnap);
  const zoomBy = useStore((s) => s.zoomBy);
  const zoomToFit = useStore((s) => s.zoomToFit);
  const followPlayhead = useStore((s) => s.view.followPlayhead);
  const toggleFollow = useStore((s) => s.toggleFollow);

  // Live position: written on every tick, flushed to React at ~30fps.
  const [pos, setPos] = useState(() => transport.position());
  const lastFlushRef = useRef(0);
  const latestPosRef = useRef(pos);

  useEffect(() => {
    const unsubscribe = transport.onTick((p) => {
      latestPosRef.current = p;
      const now = performance.now();
      // Throttle: flush at most once per READOUT_INTERVAL_MS. The transport
      // pushes a final tick on every stop/pause/seek, so the last value is
      // never older than one frame — but guarantee freshness by flushing
      // whenever enough time has elapsed.
      if (now - lastFlushRef.current >= READOUT_INTERVAL_MS) {
        lastFlushRef.current = now;
        setPos(p);
      }
    });
    return unsubscribe;
  }, []);

  // When playback stops/pauses we may have skipped the final value due to the
  // throttle; reconcile to the authoritative position whenever it settles.
  useEffect(() => {
    if (!isPlaying) setPos(transport.position());
  }, [isPlaying]);

  const onTogglePlay = () => {
    void transport.togglePlay();
  };

  return (
    <div className="transport" role="group" aria-label="Transport controls">
      <div className="transport-group">
        <button
          type="button"
          className="icon transport-btn"
          onClick={() => transport.stop()}
          title="Stop (return to start)"
          aria-label="Stop"
        >
          <Square size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon transport-btn transport-play"
          onClick={onTogglePlay}
          title={isPlaying ? 'Pause' : 'Play'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          aria-pressed={isPlaying}
        >
          {isPlaying ? (
            <Pause size={20} aria-hidden="true" />
          ) : (
            <Play size={20} aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="divider" />

      <div className="transport-group">
        <button
          type="button"
          className="transport-btn transport-jump"
          onClick={() => transport.jumpSection(-1)}
          title="Previous section"
          aria-label="Previous section"
        >
          <ChevronsLeft size={16} aria-hidden="true" />
          <span>Sec</span>
        </button>
        <button
          type="button"
          className="transport-btn transport-jump"
          onClick={() => transport.jumpSection(1)}
          title="Next section"
          aria-label="Next section"
        >
          <span>Sec</span>
          <ChevronsRight size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="transport-btn transport-jump"
          onClick={() => transport.jumpBar(-1)}
          title="Previous bar"
          aria-label="Previous bar"
        >
          <ChevronLeft size={16} aria-hidden="true" />
          <span>Bar</span>
        </button>
        <button
          type="button"
          className="transport-btn transport-jump"
          onClick={() => transport.jumpBar(1)}
          title="Next bar"
          aria-label="Next bar"
        >
          <span>Bar</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="divider" />

      <div className="transport-readout" aria-label="Playback position">
        <span className="tabular transport-bars" title="Bars : beats">
          {formatBarsBeats(pos, grid)}
        </span>
        <span className="transport-readout-sep" aria-hidden="true">
          /
        </span>
        <span className="tabular transport-clock" title="Minutes : seconds . milliseconds">
          {formatClock(pos)}
        </span>
      </div>

      <div className="spacer" />

      <div className="transport-group">
        <label className="transport-field">
          <span className="transport-field-label">Snap</span>
          <select
            value={snap}
            onChange={(e) => setSnap(e.target.value as SnapResolution)}
            aria-label="Snap resolution"
          >
            {SNAP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="divider" />

      <div className="transport-group">
        <button
          type="button"
          className="icon transport-btn"
          onClick={() => zoomBy(0.8)}
          title="Zoom out"
          aria-label="Zoom out"
        >
          <ZoomOut size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon transport-btn"
          onClick={() => zoomBy(1.25)}
          title="Zoom in"
          aria-label="Zoom in"
        >
          <ZoomIn size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon transport-btn"
          onClick={() => zoomToFit()}
          title="Fit to window"
          aria-label="Fit to window"
        >
          <Maximize size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="divider" />

      <button
        type="button"
        className={`transport-btn transport-follow${followPlayhead ? ' active' : ''}`}
        onClick={() => toggleFollow()}
        title="Follow playhead"
        aria-label="Follow playhead"
        aria-pressed={followPlayhead}
      >
        <Crosshair size={16} aria-hidden="true" />
        <span>Follow</span>
      </button>
    </div>
  );
}

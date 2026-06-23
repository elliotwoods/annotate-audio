// Timeline coordinator (spec §3 "single source of time", §14 layout). Lays out the
// ruler/waveform/lanes strips, measures the lane width (→ store.laneWidth so every
// layer shares it), and owns viewport interactions: wheel zoom / horizontal scroll,
// free click-scrub on ruler+waveform, and a horizontal scrollbar. The playhead is a
// cheap overlay updated outside React (see Playhead).

import { useEffect, useLayoutEffect, useRef } from 'react';
import './Timeline.css';
import { RulerCanvas } from './RulerCanvas';
import { TimeRulerCanvas } from './TimeRulerCanvas';
import { WaveformCanvas } from './WaveformCanvas';
import { Lanes } from './Lanes';
import { Playhead } from './Playhead';
import { useStore } from '../store/store';
import { useView, useAudio, useContentDuration } from '../store/selectors';
import { xToTime, clampScroll } from '../core/transform';
import { transport } from '../audio/transport';
import { RULER_H, TIME_RULER_H, WAVEFORM_H } from './metrics';

export function Timeline() {
  const view = useView();
  const audio = useAudio();
  const laneWidth = useStore((s) => s.laneWidth);
  const gutterWidth = useStore((s) => s.gutterWidth);
  const prepWidth = useStore((s) => s.prepWidth);
  const contentDuration = useContentDuration();

  const rootRef = useRef<HTMLDivElement>(null);
  const laneMeasureRef = useRef<HTMLDivElement>(null);
  const lanesScrollRef = useRef<HTMLDivElement>(null);

  // ── measure the lane width → store ─────────────────────────────────────────
  useLayoutEffect(() => {
    const el = laneMeasureRef.current;
    if (!el) return;
    const apply = () => useStore.getState().setLaneWidth(el.clientWidth);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── wheel: ctrl/meta = zoom (focal at cursor); else horizontal scroll ───────
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      const s = useStore.getState();
      const v = s.view;
      const rect = laneMeasureRef.current?.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const focalX = rect ? e.clientX - rect.left : s.laneWidth / 2;
        s.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, focalX);
        return;
      }
      const overLanes = !!lanesScrollRef.current && lanesScrollRef.current.contains(e.target as Node);
      const horizontalIntent = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (horizontalIntent || !overLanes) {
        e.preventDefault();
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const next = clampScroll(
          v.scrollSec + delta / v.pixelsPerSecond,
          v,
          s.laneWidth,
          contentDurationFromState(),
        );
        s.setScrollSec(next);
      }
      // else: plain vertical wheel over lanes → native row scroll (don't preventDefault)
    };
    // Suppress the native middle-button autoscroll (Windows) so middle-drag pans instead;
    // preventDefault on the React pointerdown isn't reliable for this.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    root.addEventListener('mousedown', onMouseDown);
    return () => {
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('mousedown', onMouseDown);
    };
  }, []);

  // ── free click-scrub on ruler + waveform (LEFT button, no snap, spec §8.2/§11) ──
  const scrubbing = useRef(false);
  const scrub = (clientX: number) => {
    const rect = laneMeasureRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = clientX - rect.left;
    transport.seek(Math.max(0, xToTime(x, useStore.getState().view)));
  };
  const onScrubDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // left only; right/middle pan is handled on the root
    scrubbing.current = true;
    scrub(e.clientX);
  };

  // ── pan: right- or middle-button drag anywhere in the timeline ──────────────
  const pan = useRef<{ startX: number; startScroll: number } | null>(null);
  const onRootPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 2 && e.button !== 1) return;
    e.preventDefault();
    pan.current = { startX: e.clientX, startScroll: useStore.getState().view.scrollSec };
    document.body.style.cursor = 'grabbing';
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (scrubbing.current) {
        scrub(e.clientX);
        return;
      }
      const p = pan.current;
      if (!p) return;
      const v = useStore.getState().view;
      const next = clampScroll(
        p.startScroll - (e.clientX - p.startX) / v.pixelsPerSecond,
        v,
        useStore.getState().laneWidth,
        contentDurationFromState(),
      );
      useStore.getState().setScrollSec(next);
    };
    const onUp = () => {
      scrubbing.current = false;
      if (pan.current) {
        pan.current = null;
        document.body.style.cursor = '';
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // pointercancel: the OS/browser can take over a gesture without a pointerup — clean
    // up so the pan/scrub doesn't get stuck (mirrors BlockView/Lanes).
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  return (
    <div
      className="timeline"
      ref={rootRef}
      style={
        {
          ['--gutter-w' as string]: `${gutterWidth}px`,
          ['--prep-w' as string]: `${prepWidth}px`,
        } as React.CSSProperties
      }
      onPointerDown={onRootPointerDown}
      onContextMenu={(e) => {
        // Suppress the menu for right-drag panning, but keep it on editable fields.
        if (!(e.target as HTMLElement).closest('input, textarea, [contenteditable]')) {
          e.preventDefault();
        }
      }}
    >
      <div className="tl-strip">
        <div className="tl-prep-corner tl-ruler-label">Prep</div>
        <div className="tl-corner tl-ruler-label">Bars</div>
        <div className="tl-lane" onPointerDown={onScrubDown} style={{ height: RULER_H }}>
          <RulerCanvas width={laneWidth} height={RULER_H} />
        </div>
      </div>

      <div className="tl-strip">
        <div className="tl-prep-corner" />
        <div className="tl-corner tl-ruler-label">Time</div>
        <div className="tl-lane" onPointerDown={onScrubDown} style={{ height: TIME_RULER_H }}>
          <TimeRulerCanvas width={laneWidth} height={TIME_RULER_H} />
        </div>
      </div>

      <div className="tl-strip">
        <div className="tl-prep-corner" />
        <div className="tl-gutter-label" title={audio?.fileName}>
          {audio ? audio.fileName : 'No audio'}
        </div>
        <div className="tl-lane" onPointerDown={onScrubDown} style={{ height: WAVEFORM_H }}>
          <WaveformCanvas width={laneWidth} height={WAVEFORM_H} />
        </div>
      </div>

      <div className="tl-lanes" ref={lanesScrollRef}>
        {/* Zero-height probe that measures the lane width AS IT IS inside the scroll
            container (i.e. accounting for the reserved vertical-scrollbar gutter), so the
            ruler/waveform/playhead all share the exact cue-lane width. */}
        <div className="tl-measure" aria-hidden="true">
          <div />
          <div />
          <div ref={laneMeasureRef} />
        </div>
        <Lanes />
      </div>

      <HScrollbar
        view={view}
        laneWidth={laneWidth}
        contentDuration={contentDuration}
        onScroll={(sec) => useStore.getState().setScrollSec(sec)}
      />

      <Playhead />

      {/* Two column dividers: prep|gutter at x=prepWidth, gutter|lane at x=prepWidth+gutterWidth. */}
      <ColumnResizer
        leftPx={prepWidth}
        value={prepWidth}
        resetTo={180}
        label="Resize prep column"
        onResize={(px) => useStore.getState().setPrepWidth(px)}
      />
      <ColumnResizer
        leftPx={prepWidth + gutterWidth}
        value={gutterWidth}
        resetTo={192}
        label="Resize row-header column"
        onResize={(px) => useStore.getState().setGutterWidth(px)}
      />
    </div>
  );
}

// ── a draggable vertical column divider ─────────────────────────────────────────
function ColumnResizer({
  leftPx,
  value,
  resetTo,
  label,
  onResize,
}: {
  leftPx: number;
  value: number;
  resetTo: number;
  label: string;
  onResize: (px: number) => void;
}) {
  const drag = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      onResize(d.startW + (e.clientX - d.startX));
    };
    const onUp = () => {
      drag.current = null;
      document.body.style.cursor = '';
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [onResize]);

  return (
    <div
      className="tl-col-resizer"
      style={{ left: leftPx }}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title={`${label} (double-click to reset)`}
      onPointerDown={(e) => {
        e.preventDefault();
        drag.current = { startX: e.clientX, startW: value };
        document.body.style.cursor = 'col-resize';
      }}
      onDoubleClick={() => onResize(resetTo)}
    />
  );
}

function contentDurationFromState(): number {
  const s = useStore.getState();
  if (s.core.audio) return s.core.audio.duration;
  const maxEnd = s.core.blocks.reduce((m, b) => Math.max(m, b.end), 0);
  return maxEnd > 0 ? maxEnd : 60;
}

// ── horizontal scrollbar ──────────────────────────────────────────────────────
function HScrollbar({
  view,
  laneWidth,
  contentDuration,
  onScroll,
}: {
  view: { pixelsPerSecond: number; scrollSec: number };
  laneWidth: number;
  contentDuration: number;
  onScroll: (sec: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startScroll: number } | null>(null);

  const visibleSec = laneWidth / view.pixelsPerSecond;
  const total = Math.max(contentDuration, visibleSec);
  const thumbFrac = Math.min(1, visibleSec / total);
  const leftFrac = total > 0 ? view.scrollSec / total : 0;

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const track = trackRef.current;
      if (!d || !track) return;
      const dx = e.clientX - d.startX;
      const secPerPx = total / track.clientWidth;
      onScroll(Math.max(0, Math.min(total - visibleSec, d.startScroll + dx * secPerPx)));
    };
    const onUp = () => (dragRef.current = null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [total, visibleSec, onScroll]);

  if (thumbFrac >= 1) return <div className="tl-hscroll empty" />;

  return (
    <div className="tl-hscroll" ref={trackRef}>
      <div
        className="tl-hscroll-thumb"
        style={{ left: `${leftFrac * 100}%`, width: `${thumbFrac * 100}%` }}
        onPointerDown={(e) => {
          e.preventDefault();
          dragRef.current = { startX: e.clientX, startScroll: view.scrollSec };
        }}
      />
    </div>
  );
}

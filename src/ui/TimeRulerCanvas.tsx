// Time ruler (mm:ss). DPR-scaled canvas using the SHARED transform. Independent of the
// beat grid — anchored at t=0 — so it works even before a BPM is set. Adaptive: picks a
// "nice" seconds step (with finer minor ticks) so labels never collide at any zoom.

import { useEffect, useRef } from 'react';
import { useView } from '../store/selectors';
import { timeToX, visibleRange } from '../core/transform';
import { niceTimeStep, formatTimeTick } from '../core/ticks';
import './RulerCanvas.css';

const MIN_LABEL_PX = 60; // min gap between time labels
const MIN_MINOR_PX = 11; // min gap between minor (unlabelled) ticks

export function TimeRulerCanvas({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const view = useView();
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(canvas);
    const bg = css.getPropertyValue('--ruler-bg').trim() || '#0e1117';
    const tickColor = css.getPropertyValue('--grid-beat').trim() || 'rgba(255,255,255,0.06)';
    const majColor = css.getPropertyValue('--grid-bar').trim() || 'rgba(255,255,255,0.16)';
    const labelColor = css.getPropertyValue('--text-2').trim() || '#6b7484';
    const mono = css.getPropertyValue('--mono').trim() || 'ui-monospace, Menlo, Consolas, monospace';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const pps = view.pixelsPerSecond;
    if (!(pps > 0)) return;
    const [rawT0, t1] = visibleRange(view, width);
    const t0 = Math.max(0, rawT0); // no negative time

    const labelStep = niceTimeStep(pps, MIN_LABEL_PX);
    // Derive minor ticks as an EVEN subdivision of the labelled interval (so every label
    // sits on a minor tick), picking the finest split that still clears MIN_MINOR_PX.
    let minorStep = 0;
    for (const k of [5, 4, 2]) {
      const cand = labelStep / k;
      if (cand * pps >= MIN_MINOR_PX) {
        minorStep = cand;
        break;
      }
    }

    // Minor ticks.
    if (minorStep > 0) {
      ctx.strokeStyle = tickColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let n = Math.ceil(t0 / minorStep); n * minorStep <= t1; n++) {
        const t = n * minorStep;
        const x = Math.round(timeToX(t, view)) + 0.5;
        if (x < -1 || x > width + 1) continue;
        ctx.moveTo(x, Math.round(height * 0.6));
        ctx.lineTo(x, height);
      }
      ctx.stroke();
    }

    // Major ticks + labels.
    ctx.textBaseline = 'middle';
    ctx.font = `10px ${mono}`;
    for (let n = Math.ceil(t0 / labelStep); n * labelStep <= t1; n++) {
      const t = n * labelStep;
      const x = Math.round(timeToX(t, view)) + 0.5;
      if (x < -1 || x > width + 1) continue;
      ctx.strokeStyle = majColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, Math.round(height * 0.32));
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.fillStyle = labelColor;
      ctx.fillText(formatTimeTick(t, labelStep), x + 4, Math.round(height / 2));
    }
  }, [width, height, view.pixelsPerSecond, view.scrollSec, dpr]);

  return <canvas ref={canvasRef} className="ruler-canvas" />;
}

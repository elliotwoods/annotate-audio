// Bars/beats ruler (spec §6/§9.2). DPR-scaled canvas using the SHARED transform so a
// bar line here lands at the exact same x as a snapped block edge (acceptance §17).
//
// Adaptive density: label/line every 1/2/4/8/… bars so numbers never collide when
// zoomed out, and only draw beat sub-ticks when there's room for them.

import { useEffect, useRef } from 'react';
import { useView, useGrid } from '../store/selectors';
import { timeToX, visibleRange } from '../core/transform';
import { barLen, beatLen, gridLines, barLines } from '../core/grid';
import { niceBarStep, mod } from '../core/ticks';
import './RulerCanvas.css';

const MIN_LINE_PX = 7; // min gap between drawn bar lines
const MIN_LABEL_PX = 46; // min gap between bar-number labels
const MIN_BEAT_PX = 9; // draw beat sub-ticks only when a beat is at least this wide

export function RulerCanvas({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const view = useView();
  const grid = useGrid();
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
    const barColor = css.getPropertyValue('--grid-bar').trim() || 'rgba(255,255,255,0.16)';
    const beatColor = css.getPropertyValue('--grid-beat').trim() || 'rgba(255,255,255,0.06)';
    const labelColor = css.getPropertyValue('--text-1').trim() || '#aab2c3';
    const mono = css.getPropertyValue('--mono').trim() || 'ui-monospace, Menlo, Consolas, monospace';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    if (!Number.isFinite(grid.bpm) || grid.bpm <= 0) return;

    const [t0, t1] = visibleRange(view, width);
    const pps = view.pixelsPerSecond;
    const pxPerBar = barLen(grid) * pps;
    const pxPerBeat = beatLen(grid) * pps;

    const lineStep = niceBarStep(pxPerBar, MIN_LINE_PX);
    const labelStep = Math.max(lineStep, niceBarStep(pxPerBar, MIN_LABEL_PX));
    const drawBeats = lineStep === 1 && pxPerBeat >= MIN_BEAT_PX;

    // Light beat sub-ticks (only when fully zoomed in).
    if (drawBeats) {
      ctx.strokeStyle = beatColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const line of gridLines(t0, t1, grid)) {
        if (line.isDownbeat) continue;
        const x = Math.round(timeToX(line.time, view)) + 0.5;
        if (x < -1 || x > width + 1) continue;
        ctx.moveTo(x, Math.round(height * 0.62));
        ctx.lineTo(x, height);
      }
      ctx.stroke();
    }

    // Bar lines + numbers, thinned to lineStep / labelStep.
    ctx.textBaseline = 'middle';
    ctx.font = `10px ${mono}`;
    for (const b of barLines(t0, t1, grid)) {
      const n = b.bar - 1; // 0-based bar index
      if (mod(n, lineStep) !== 0) continue;
      const x = Math.round(timeToX(b.time, view)) + 0.5;
      if (x < -1 || x > width + 1) continue;
      const labeled = mod(n, labelStep) === 0;

      ctx.strokeStyle = barColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, labeled ? 0 : Math.round(height * 0.45));
      ctx.lineTo(x, height);
      ctx.stroke();

      if (labeled) {
        ctx.fillStyle = labelColor;
        ctx.fillText(String(b.bar), x + 4, Math.round(height / 2));
      }
    }
  }, [width, height, view.pixelsPerSecond, view.scrollSec, grid, dpr]);

  return <canvas ref={canvasRef} className="ruler-canvas" />;
}

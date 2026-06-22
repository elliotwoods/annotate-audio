// Ruler strip (spec §9.2 / §14). A DPR-scaled <canvas> that draws beat ticks and
// bar-number labels using the SHARED coordinate transform so a bar line here lands at
// the exact same x as a snapped block edge in the lanes (acceptance criterion §17).
//
// x = 0 is the LEFT EDGE of the lane cell (just right of the fixed gutter).

import { useEffect, useRef } from 'react';
import { useView, useGrid } from '../store/selectors';
import { timeToX, visibleRange } from '../core/transform';
import { gridLines } from '../core/grid';
import './RulerCanvas.css';

export function RulerCanvas({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const view = useView();
  const grid = useGrid();
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (width <= 0 || height <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Size the backing store for crispness; draw in CSS pixel space.
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const css = getComputedStyle(canvas);
    const bg = css.getPropertyValue('--ruler-bg').trim() || '#0e1117';
    const barColor = css.getPropertyValue('--grid-bar').trim() || 'rgba(255,255,255,0.16)';
    const beatColor = css.getPropertyValue('--grid-beat').trim() || 'rgba(255,255,255,0.06)';
    const labelColor = css.getPropertyValue('--text-2').trim() || '#6b7484';
    const mono =
      css.getPropertyValue('--mono').trim() ||
      'ui-monospace, Menlo, Consolas, monospace';

    // Background.
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Invalid grid (bpm <= 0 etc.) — nothing to draw but the background.
    if (!Number.isFinite(grid.bpm) || grid.bpm <= 0) return;

    const [t0, t1] = visibleRange(view, width);

    ctx.textBaseline = 'top';
    ctx.font = `10px ${mono}`;

    const beatTickTop = Math.round(height * 0.55);
    const barTickTop = 0;

    for (const line of gridLines(t0, t1, grid)) {
      // Pixel-snap to a crisp 1px line.
      const x = Math.round(timeToX(line.time, view)) + 0.5;
      if (x < -1 || x > width + 1) continue;

      ctx.beginPath();
      if (line.isDownbeat) {
        ctx.strokeStyle = barColor;
        ctx.lineWidth = 1;
        ctx.moveTo(x, barTickTop);
        ctx.lineTo(x, height);
        ctx.stroke();

        // Bar number label just right of the downbeat tick.
        ctx.fillStyle = labelColor;
        ctx.fillText(String(line.bar), x + 3, 2);
      } else {
        ctx.strokeStyle = beatColor;
        ctx.lineWidth = 1;
        ctx.moveTo(x, beatTickTop);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
    }
  }, [width, height, view.pixelsPerSecond, view.scrollSec, grid, dpr]);

  return <canvas ref={canvasRef} className="ruler-canvas" />;
}

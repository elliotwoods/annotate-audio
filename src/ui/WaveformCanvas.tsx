// Waveform strip (spec §9). A DPR-scaled <canvas> that draws, in order:
//   1. faint vertical gridlines (so the waveform reads as aligned to the bar grid), and
//   2. the summed-mono min/max peak strip aggregated from the base peaks buckets.
//
// Everything is positioned with the SHARED transform (timeToX / xToTime) so a bar line
// here lands at the exact same x as a snapped block edge in the lanes (acceptance §17).
// x = 0 is the LEFT EDGE of the lane cell.
//
// Redraws only when dirty, via requestAnimationFrame; the rAF is cancelled on cleanup.
// It never redraws on a timer while idle.

import { useEffect, useRef } from 'react';
import { useView, useGrid } from '../store/selectors';
import { useStore } from '../store/store';
import { timeToX, xToTime, visibleRange } from '../core/transform';
import { gridLines } from '../core/grid';
import type { PeaksData } from '../audio/peaksTypes';
import './WaveformCanvas.css';

export function WaveformCanvas({ width, height }: { width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const view = useView();
  const grid = useGrid();
  const peaks = useStore((s) => s.peaks);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (width <= 0 || height <= 0) return;

    const draw = () => {
      rafRef.current = null;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Size backing store; draw in CSS pixel space.
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const css = getComputedStyle(canvas);
      const barColor = css.getPropertyValue('--grid-bar').trim() || 'rgba(255,255,255,0.16)';
      const beatColor = css.getPropertyValue('--grid-beat').trim() || 'rgba(255,255,255,0.06)';
      const waveColor = css.getPropertyValue('--waveform').trim() || '#5b6b8c';
      const baseColor = css.getPropertyValue('--line').trim() || '#2a2f3a';

      ctx.clearRect(0, 0, width, height);

      const [t0, t1] = visibleRange(view, width);
      const midY = height / 2;
      const gridValid = Number.isFinite(grid.bpm) && grid.bpm > 0;

      // 1. Faint gridlines first, so the waveform visually sits on the grid.
      if (gridValid) {
        for (const line of gridLines(t0, t1, grid)) {
          const x = Math.round(timeToX(line.time, view)) + 0.5;
          if (x < -1 || x > width + 1) continue;
          ctx.beginPath();
          ctx.strokeStyle = line.isDownbeat ? barColor : beatColor;
          ctx.lineWidth = 1;
          ctx.moveTo(x, 0);
          ctx.lineTo(x, height);
          ctx.stroke();
        }
      }

      // Center baseline (subtle).
      ctx.beginPath();
      ctx.strokeStyle = baseColor;
      ctx.lineWidth = 1;
      ctx.moveTo(0, Math.round(midY) + 0.5);
      ctx.lineTo(width, Math.round(midY) + 0.5);
      ctx.stroke();

      // 2. Waveform. Nothing to draw without peaks (the JSX hint handles the message).
      if (!peaks) return;
      drawWaveform(ctx, peaks, view, width, midY, waveColor);
    };

    // Dirty-redraw via rAF; coalesce multiple deps changes in one frame.
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [width, height, view.pixelsPerSecond, view.scrollSec, peaks, grid, dpr]);

  return (
    <div className="waveform-canvas-wrap">
      <canvas ref={canvasRef} className="waveform-canvas" />
      {!peaks && width > 0 && height > 0 ? (
        <div className="waveform-canvas-hint">Load audio</div>
      ) : null}
    </div>
  );
}

/**
 * Draw the summed-mono peak strip. For each pixel column, find the base buckets whose
 * time span overlaps [xToTime(x), xToTime(x+1)] and aggregate their min/max, then draw a
 * vertical line from minY to maxY. Amplitude in [-1, 1] maps to y around midY.
 */
function drawWaveform(
  ctx: CanvasRenderingContext2D,
  peaks: PeaksData,
  view: { pixelsPerSecond: number; scrollSec: number },
  width: number,
  midY: number,
  color: string,
): void {
  const { min, max, samplesPerBucket, sampleRate } = peaks;
  const bucketCount = Math.min(min.length, max.length);
  if (bucketCount === 0 || samplesPerBucket <= 0 || sampleRate <= 0) return;

  // Seconds covered by one base bucket.
  const bucketTime = samplesPerBucket / sampleRate;
  const halfH = midY; // amplitude 1 reaches the top edge / bottom edge

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let x = 0; x < width; x++) {
    const tA = xToTime(x, view);
    const tB = xToTime(x + 1, view);
    if (tB <= 0) continue; // entirely before the start of audio

    // Base bucket index range overlapping this column. Clamp to valid buckets.
    let b0 = Math.floor(tA / bucketTime);
    let b1 = Math.floor(tB / bucketTime);
    if (b0 < 0) b0 = 0;
    if (b1 >= bucketCount) b1 = bucketCount - 1;
    // At least sample the bucket at the column's left time, in case a single bucket
    // spans many pixels (very high zoom) and the floors collapse.
    if (b1 < b0) {
      if (b0 >= bucketCount) continue;
      b1 = b0;
    }
    if (b0 >= bucketCount) continue;

    let lo = Infinity;
    let hi = -Infinity;
    for (let b = b0; b <= b1; b++) {
      const mn = min[b];
      const mx = max[b];
      if (mn < lo) lo = mn;
      if (mx > hi) hi = mx;
    }
    if (lo === Infinity || hi === -Infinity) continue;

    // Map amplitude [-1,1] to y; +1 -> top (midY - halfH), -1 -> bottom (midY + halfH).
    let yTop = midY - hi * halfH;
    let yBot = midY - lo * halfH;
    // Guarantee at least a 1px tall line so a quiet column is still visible.
    if (yBot - yTop < 1) {
      const c = (yTop + yBot) / 2;
      yTop = c - 0.5;
      yBot = c + 0.5;
    }

    const px = x + 0.5;
    ctx.moveTo(px, yTop);
    ctx.lineTo(px, yBot);
  }

  ctx.stroke();
}

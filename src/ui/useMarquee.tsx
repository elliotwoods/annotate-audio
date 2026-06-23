// Rubber-band (marquee) selection across all rows. A drag on empty lane space draws a box;
// on release every cue whose rendered rect intersects the box becomes the selection (Shift to
// add to the existing selection). A sub-threshold drag is a plain click and clears selection.
//
// Hit-testing reads the rendered blocks (data-block-id) in client coordinates, so it works
// across rows and under scroll/zoom without any per-row geometry math. Mirrors useRowDnD's
// ref-based handler pattern.

import { useCallback, useRef, useState, type RefObject } from 'react';
import { useStore } from '../store/store';

/** Movement (px) below which the gesture counts as a click, not a marquee. */
const THRESHOLD = 3;

interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function useMarquee(lanesRef: RefObject<HTMLDivElement | null>) {
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);
  const drag = useRef<{ x0: number; y0: number; x1: number; y1: number; additive: boolean } | null>(null);

  const handlers = useRef({
    move(e: PointerEvent) {
      const d = drag.current;
      const lanes = lanesRef.current;
      if (!d || !lanes) return;
      d.x1 = e.clientX;
      d.y1 = e.clientY;
      const lr = lanes.getBoundingClientRect();
      setOverlayRect({
        left: Math.min(d.x0, d.x1) - lr.left,
        top: Math.min(d.y0, d.y1) - lr.top,
        width: Math.abs(d.x1 - d.x0),
        height: Math.abs(d.y1 - d.y0),
      });
    },
    up() {
      const d = drag.current;
      const lanes = lanesRef.current;
      cleanup();
      if (!d || !lanes) return;
      const store = useStore.getState();
      const moved = Math.abs(d.x1 - d.x0) > THRESHOLD || Math.abs(d.y1 - d.y0) > THRESHOLD;
      if (!moved) {
        // A plain click on empty space clears selection; Shift+click leaves it intact.
        if (!d.additive) store.clearSelection();
        return;
      }
      const box = {
        left: Math.min(d.x0, d.x1),
        right: Math.max(d.x0, d.x1),
        top: Math.min(d.y0, d.y1),
        bottom: Math.max(d.y0, d.y1),
      };
      const hits: string[] = [];
      for (const el of lanes.querySelectorAll<HTMLElement>('[data-block-id]')) {
        const r = el.getBoundingClientRect();
        if (r.left <= box.right && r.right >= box.left && r.top <= box.bottom && r.bottom >= box.top) {
          const id = el.dataset.blockId;
          if (id) hits.push(id);
        }
      }
      if (d.additive) store.setSelection([...new Set([...store.selection, ...hits])]);
      else store.setSelection(hits);
    },
    cancel() {
      cleanup();
    },
  });

  function cleanup(): void {
    window.removeEventListener('pointermove', handlers.current.move);
    window.removeEventListener('pointerup', handlers.current.up);
    window.removeEventListener('pointercancel', handlers.current.cancel);
    window.removeEventListener('keydown', onKey);
    drag.current = null;
    setOverlayRect(null);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') handlers.current.cancel();
  }

  const onMarqueeStart = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      drag.current = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, additive: e.shiftKey };
      window.addEventListener('pointermove', handlers.current.move);
      window.addEventListener('pointerup', handlers.current.up);
      window.addEventListener('pointercancel', handlers.current.cancel);
      window.addEventListener('keydown', onKey);
    },
    // handlers/onKey are stable (ref + first-render closures), matching useRowDnD.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const overlay = overlayRect ? <div className="lanes__marquee" style={overlayRect} /> : null;

  return { onMarqueeStart, overlay };
}

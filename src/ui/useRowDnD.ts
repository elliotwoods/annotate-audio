// Gutter drag-and-drop for reorganizing the row tree (reorder siblings + nest into groups).
// Vertical-only — never touches the lane x-origin, so horizontal alignment is unaffected.
// Hit-testing reads the rendered row strips (data-rowid) so it stays correct under any
// nesting/scroll; the commit goes through the cycle-safe store primitive `setParent`.

import { useCallback, useRef, useState, type RefObject } from 'react';
import { useStore } from '../store/store';
import { subtreeIds } from '../core/rowtree';

export interface DropIndicator {
  /** Top offset (px) within the lanes content where the indicator draws. */
  top: number;
  /** Height (px) for an "into a group" highlight; undefined for an insertion line. */
  height?: number;
  into: boolean;
  valid: boolean;
}

type Target = { kind: 'into'; groupId: string } | { kind: 'sibling'; parentId: string | null; index: number };

const EDGE = 28; // px from the scroll-container edge that triggers auto-scroll

export function useRowDnD(lanesRef: RefObject<HTMLDivElement | null>) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingSubtree, setDraggingSubtree] = useState<Set<string>>(() => new Set());
  const [indicator, setIndicator] = useState<DropIndicator | null>(null);

  const drag = useRef<{ id: string; subtree: Set<string> } | null>(null);
  const target = useRef<Target | null>(null);

  const handlers = useRef({
    move(e: PointerEvent) {
      const lanes = lanesRef.current;
      const d = drag.current;
      if (!lanes || !d) return;

      const rows = useStore.getState().core.rows;
      const byId = new Map(rows.map((r) => [r.id, r]));
      const lanesRect = lanes.getBoundingClientRect();
      const y = e.clientY;

      // Auto-scroll the vertical scroll container near its edges.
      const scroller = lanes.closest<HTMLElement>('.tl-lanes');
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (y < r.top + EDGE) scroller.scrollTop -= 10;
        else if (y > r.bottom - EDGE) scroller.scrollTop += 10;
      }

      // Find the row strip under the pointer (or clamp to first/last).
      const strips = Array.from(lanes.querySelectorAll<HTMLElement>('[data-rowid]'));
      if (strips.length === 0) return;
      let hovered: { id: string; rect: DOMRect } | null = null;
      for (const el of strips) {
        const rect = el.getBoundingClientRect();
        if (y >= rect.top && y <= rect.bottom) {
          hovered = { id: el.dataset.rowid!, rect };
          break;
        }
      }
      if (!hovered) {
        const firstRect = strips[0].getBoundingClientRect();
        if (y < firstRect.top) hovered = { id: strips[0].dataset.rowid!, rect: firstRect };
        else {
          const lastEl = strips[strips.length - 1];
          hovered = { id: lastEl.dataset.rowid!, rect: lastEl.getBoundingClientRect() };
        }
      }

      const row = byId.get(hovered.id);
      if (!row) return;
      const rel = (y - hovered.rect.top) / Math.max(1, hovered.rect.height);
      const sub = d.subtree;

      let tgt: Target | null = null;
      let top: number;
      let into = false;
      let height: number | undefined;

      const fixed = row.kind === 'track' || row.kind === 'section';
      if (fixed) {
        // Can't drop onto the pinned rows; show the topmost insertion (after section).
        tgt = sub.has(row.id) ? null : { kind: 'sibling', parentId: null, index: 0 };
        top = hovered.rect.bottom - lanesRect.top;
      } else if (row.kind === 'group' && rel > 0.25 && rel < 0.75) {
        into = true;
        height = hovered.rect.height;
        top = hovered.rect.top - lanesRect.top;
        tgt = sub.has(row.id) ? null : { kind: 'into', groupId: row.id };
      } else {
        const before = rel < 0.5;
        top = (before ? hovered.rect.top : hovered.rect.bottom) - lanesRect.top;
        if (sub.has(row.id)) {
          tgt = null; // can't drop relative to a row in the dragged subtree
        } else {
          const parentId = row.parentId ?? null;
          const movable = rows
            .filter(
              (r) =>
                (r.parentId ?? null) === parentId &&
                r.kind !== 'track' &&
                r.kind !== 'section' &&
                !sub.has(r.id),
            )
            .sort((a, b) => a.order - b.order);
          const xi = movable.findIndex((r) => r.id === row.id);
          const index = before ? Math.max(0, xi) : xi + 1;
          tgt = { kind: 'sibling', parentId, index };
        }
      }

      target.current = tgt;
      setIndicator({ top, into, height, valid: tgt !== null });
    },
    up() {
      const d = drag.current;
      const tgt = target.current;
      cleanup();
      if (!d || !tgt) return;
      if (tgt.kind === 'into') useStore.getState().setParent(d.id, tgt.groupId);
      else useStore.getState().setParent(d.id, tgt.parentId, tgt.index);
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
    target.current = null;
    setDraggingId(null);
    setDraggingSubtree(new Set());
    setIndicator(null);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') handlers.current.cancel();
  }

  const onGripPointerDown = useCallback(
    (e: React.PointerEvent, rowId: string) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const rows = useStore.getState().core.rows;
      const row = rows.find((r) => r.id === rowId);
      if (!row || row.kind === 'track' || row.kind === 'section') return;
      const subtree = subtreeIds(rows, rowId);
      drag.current = { id: rowId, subtree };
      target.current = null;
      setDraggingId(rowId);
      setDraggingSubtree(subtree);
      setIndicator(null);
      window.addEventListener('pointermove', handlers.current.move);
      window.addEventListener('pointerup', handlers.current.up);
      window.addEventListener('pointercancel', handlers.current.cancel);
      window.addEventListener('keydown', onKey);
    },
    // handlers/cleanup are stable via refs; no deps needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { draggingId, draggingSubtree, indicator, onGripPointerDown };
}

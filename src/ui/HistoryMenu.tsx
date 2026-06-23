// HistoryMenu — the "history of edits" dropdown opened from the toolbar. Lists every undo
// step (past → current → redoable future) with a human-readable label; clicking any row
// jumps straight to that point via a multi-step undo()/redo().
//
// The undo engine (zundo's temporal store) records the PRE-change `{ core, historyLabel }`
// on each edit, so each snapshot is self-describing. We render:
//
//   pastStates[0 .. P-1]   oldest → newest edits already applied      (click → undo(P - k))
//   LIVE                    the current state (live historyLabel)      (marked, no-op)
//   futureStates reversed   redoable edits, soonest first              (click → redo(k - P))
//
// Portalled + positioned like ProjectMenu (the toolbar clips overflow); a transparent
// backdrop and Escape close it.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore as useZustand } from 'zustand';
import { History } from 'lucide-react';
import { undo, redo, temporalStore } from '../store/store';
import { useStore } from '../store/store';
import './HistoryMenu.css';

const PANEL_WIDTH = 260;

type Row = {
  key: string;
  label: string;
  state: 'past' | 'current' | 'future';
  /** Jump to this point; undefined for the current row. */
  jump?: () => void;
};

export function HistoryMenu() {
  const past = useZustand(temporalStore, (t) => t.pastStates);
  const future = useZustand(temporalStore, (t) => t.futureStates);
  const liveLabel = useStore((s) => s.historyLabel);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const currentRowRef = useRef<HTMLButtonElement>(null);

  const place = useCallback(() => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 8));
    setPos({ top: r.bottom + 6, left });
  }, []);

  const toggle = useCallback(() => {
    setOpen((o) => {
      if (!o) place();
      return !o;
    });
  }, [place]);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const reposition = () => place();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, place]);

  // Build the combined timeline (oldest → newest). Past rows undo back to themselves; future
  // rows (reversed so the soonest redo is nearest the current marker) redo forward.
  const rows = useMemo<Row[]>(() => {
    const P = past.length;
    const out: Row[] = past.map((entry, k) => ({
      key: `p${k}`,
      label: entry.historyLabel,
      state: 'past',
      jump: () => undo(P - k),
    }));
    out.push({ key: 'current', label: liveLabel, state: 'current' });
    // futureStates is ordered so the LAST element is the next redo target; reverse for display.
    for (let j = 0; j < future.length; j++) {
      const entry = future[future.length - 1 - j];
      const steps = j + 1;
      out.push({
        key: `f${j}`,
        label: entry.historyLabel,
        state: 'future',
        jump: () => redo(steps),
      });
    }
    return out;
  }, [past, future, liveLabel]);

  // Keep the current row in view whenever the panel opens or the position changes.
  useLayoutEffect(() => {
    if (open) currentRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [open, rows]);

  return (
    <div className="topbar-group">
      <button
        ref={btnRef}
        type="button"
        className="ghost icon"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Edit history — jump to any earlier or later state"
        aria-label="Edit history"
      >
        <History size={15} aria-hidden />
      </button>

      {open &&
        createPortal(
          <>
            <div className="projectmenu-backdrop" onPointerDown={close} />
            <div
              className="projectmenu historymenu"
              role="dialog"
              aria-label="Edit history"
              style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="projectmenu-section-head historymenu-head">
                <span>History</span>
              </div>
              <div className="historymenu-list">
                {rows.map((row) => (
                  <button
                    key={row.key}
                    ref={row.state === 'current' ? currentRowRef : undefined}
                    type="button"
                    className={`projectmenu-row historymenu-row is-${row.state}`}
                    disabled={row.state === 'current'}
                    aria-current={row.state === 'current' ? 'true' : undefined}
                    onClick={
                      row.jump
                        ? () => {
                            row.jump!();
                            close();
                          }
                        : undefined
                    }
                  >
                    <span className="historymenu-dot" aria-hidden />
                    <span className="projectmenu-row-name">{row.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

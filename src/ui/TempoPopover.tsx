// "Tempo tools" toolbar button + popover holding Tap tempo and Detect BPM (spec §7.1–§7.3).
//
// The popover is portalled to <body> and positioned with fixed coordinates derived from the
// button's rect: the toolbar clips overflow vertically, so an in-flow absolute panel would
// be cut off. A transparent backdrop closes it on outside click; Escape also closes.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Gauge } from 'lucide-react';
import { TapTempo } from './TapTempo';
import { DetectPanel } from './DetectPanel';
import './TempoPopover.css';

const PANEL_WIDTH = 360;

export function TempoPopover() {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const place = useCallback(() => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    // Anchor under the button, clamped so the panel stays within the viewport.
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 8));
    setPos({ top: r.bottom + 6, left });
  }, []);

  const toggle = useCallback(() => {
    setOpen((o) => {
      if (!o) place();
      return !o;
    });
  }, [place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const reposition = () => place();
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', reposition);
    // Reposition (or it would drift) if anything scrolls under the open panel.
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, place]);

  return (
    <div className="topbar-group">
      <button
        ref={btnRef}
        type="button"
        className="ghost"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Tap tempo & automatic BPM detection"
      >
        <Gauge size={15} aria-hidden /> Tempo tools
      </button>

      {open &&
        createPortal(
          <>
            <div className="tempo-popover-backdrop" onPointerDown={() => setOpen(false)} />
            <div
              className="tempo-popover"
              role="dialog"
              aria-label="Tempo tools"
              style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <TapTempo />
              <div className="tempo-popover-divider" />
              <DetectPanel />
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

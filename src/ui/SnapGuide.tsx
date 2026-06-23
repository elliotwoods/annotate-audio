// Snap-target indicator: a vertical guide line shown across the timeline during a
// drag/resize, marking exactly what the dragged edge is snapping to. Driven by the
// transient `snapIndicator` store slice (set by BlockView/Lanes while dragging). A cue
// snap is labelled "Cue"; a grid snap is labelled with its bars:beats position.

import { useView, useGrid, useSnapIndicator } from '../store/selectors';
import { useStore } from '../store/store';
import { timeToX } from '../core/transform';
import { formatBarsBeats } from '../core/grid';
import './SnapGuide.css';

export function SnapGuide(): JSX.Element | null {
  const indicator = useSnapIndicator();
  const view = useView();
  const grid = useGrid();
  const laneWidth = useStore((s) => s.laneWidth);

  if (!indicator) return null;
  const x = timeToX(indicator.time, view);
  if (x < -2 || x > laneWidth + 2) return null; // scrolled out of the lane area

  const label = indicator.kind === 'cue' ? 'Cue' : formatBarsBeats(indicator.time, grid);

  return (
    <div className="snap-guide-clip" style={{ width: laneWidth }} aria-hidden="true">
      <div
        className={`snap-guide snap-guide--${indicator.kind}`}
        style={{ transform: `translateX(${x}px)` }}
      >
        <span className="snap-guide__label">{label}</span>
      </div>
    </div>
  );
}

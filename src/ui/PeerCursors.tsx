// Live peer-cursor overlay: a labeled vertical marker per signed-in collaborator at the
// timeline position they're hovering. Positions arrive in SECONDS (see peerCursors.ts) and are
// re-projected through THIS viewer's transform, so everyone sees each cursor at the right time
// regardless of their own zoom/scroll. Positioned in the same lane-clipped layer as the
// playhead (left = prep + gutter, width = laneWidth). Purely presentational; pointer-events off.

import { useEffect, useReducer } from 'react';
import { useView } from '../store/selectors';
import { useStore } from '../store/store';
import { timeToX } from '../core/transform';
import { livePeerCursors, subscribePeerCursors } from './peerCursorStore';
import './PeerCursors.css';

export function PeerCursors() {
  const view = useView();
  const laneWidth = useStore((s) => s.laneWidth);
  // Re-render on any cursor change (the store is throttled upstream to ~60ms).
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribePeerCursors(bump), []);

  const cursors = livePeerCursors();
  if (cursors.length === 0) return <div className="peer-cursors-clip" style={{ width: laneWidth }} />;

  return (
    <div className="peer-cursors-clip" style={{ width: laneWidth }}>
      {cursors.map((c) => {
        const x = timeToX(c.posSec, view);
        if (x < -2 || x > laneWidth + 2) return null; // off-screen at this zoom/scroll
        return (
          <div
            key={c.origin}
            className="peer-cursor"
            style={{ transform: `translateX(${x}px)`, ['--peer' as string]: c.color }}
          >
            <span className="peer-cursor__label">{c.name}</span>
          </div>
        );
      })}
    </div>
  );
}

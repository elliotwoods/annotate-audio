// Cheap playhead overlay (spec §9.2): a 1–2px line updated outside React via the
// transport tick (per-frame while playing) and repositioned on zoom/scroll changes.
// Never triggers a waveform/lane re-render.

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useView } from '../store/selectors';
import { useStore } from '../store/store';
import { timeToX } from '../core/transform';
import { transport } from '../audio/transport';
import type { ViewState } from '../model/types';

export function Playhead() {
  const view = useView();
  const laneWidth = useStore((s) => s.laneWidth);

  const lineRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(0);
  // keep latest view/width in refs so the once-registered tick handler never goes stale
  const viewRef = useRef<ViewState>(view);
  const widthRef = useRef(laneWidth);
  viewRef.current = view;
  widthRef.current = laneWidth;

  const place = (pos: number) => {
    const el = lineRef.current;
    if (!el) return;
    const x = timeToX(pos, viewRef.current);
    const w = widthRef.current;
    if (x < -2 || x > w + 2) {
      el.style.visibility = 'hidden';
    } else {
      el.style.visibility = 'visible';
      el.style.transform = `translateX(${x}px)`;
    }
  };

  // live updates from the transport clock (registered once)
  useEffect(() => {
    return transport.onTick((pos) => {
      posRef.current = pos;
      place(pos);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // reposition when zoom/scroll/width change (paused playhead must track the grid)
  useLayoutEffect(() => {
    place(posRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.pixelsPerSecond, view.scrollSec, laneWidth]);

  return (
    <div className="playhead-clip" style={{ width: laneWidth }}>
      <div className="playhead-line" ref={lineRef}>
        <div className="playhead-head" />
      </div>
    </div>
  );
}

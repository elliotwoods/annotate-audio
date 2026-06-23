// Per-user sound output (mute) toggle. Local-only, persisted to localStorage.
//
// The app has no volume slider — output gain is effectively binary — so muting sets the
// transport gain to 0 and unmuting restores full gain. The transport remembers the desired
// gain across audio (re)loads, so a mute chosen before audio is loaded still takes effect.

import { useCallback, useState } from 'react';
import { transport } from '../audio/transport';

const MUTED_KEY = 'aa.muted';

export function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    /* storage unavailable — preference simply won't persist */
  }
}

/** Apply the persisted mute preference to the transport (call once on app boot). */
export function applyPersistedMute(): void {
  transport.setGain(readMuted() ? 0 : 1);
}

export function useSoundToggle(): { muted: boolean; toggle: () => void } {
  const [muted, setMuted] = useState(readMuted);

  const toggle = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      writeMuted(next);
      transport.setGain(next ? 0 : 1);
      return next;
    });
  }, []);

  return { muted, toggle };
}

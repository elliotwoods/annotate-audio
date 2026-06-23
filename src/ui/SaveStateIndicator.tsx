// Compact save/sync status chip for the top-bar right cluster. Combines the (otherwise
// silent) autosave state, the explicit cloud-save state, and a transient confirmation note.
//
// Live-collaboration status is shown separately by the collab pill in TopBar.

import { Check, Cloud, Loader } from 'lucide-react';
import { useStore } from '../store/store';

export function SaveStateIndicator({
  cloudBusy,
  cloudMsg,
}: {
  cloudBusy: boolean;
  cloudMsg: string | null;
}) {
  const saveStatus = useStore((s) => s.saveStatus);

  // Transient cloud confirmation wins — it's the most specific, user-initiated feedback.
  if (cloudMsg) {
    return (
      <span className="topbar-savestate" title={cloudMsg}>
        <Cloud size={13} aria-hidden /> {cloudMsg}
      </span>
    );
  }

  const saving = cloudBusy || saveStatus === 'saving';
  if (saving) {
    return (
      <span className="topbar-savestate is-saving">
        <Loader size={13} aria-hidden className="spin" /> Saving…
      </span>
    );
  }

  if (saveStatus === 'saved') {
    return (
      <span className="topbar-savestate is-saved">
        <Check size={13} aria-hidden /> Saved
      </span>
    );
  }

  return null;
}

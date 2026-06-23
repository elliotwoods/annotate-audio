// Compact save/sync status chip for the top-bar right cluster. Combines the (otherwise
// silent) local autosave state with the automatic cloud-save state, both read from the
// store. Live-collaboration status is shown separately by the collab pill in TopBar.

import { Check, Cloud, CloudOff, Loader } from 'lucide-react';
import { useStore } from '../store/store';

export function SaveStateIndicator() {
  const saveStatus = useStore((s) => s.saveStatus);
  const cloudSave = useStore((s) => s.cloudSave);

  if (saveStatus === 'saving' || cloudSave === 'saving') {
    return (
      <span className="topbar-savestate is-saving">
        <Loader size={13} aria-hidden className="spin" /> Saving…
      </span>
    );
  }

  if (cloudSave === 'error') {
    return (
      <span
        className="topbar-savestate is-error"
        title="Cloud save failed — it will retry on your next edit"
      >
        <CloudOff size={13} aria-hidden /> Cloud save failed
      </span>
    );
  }

  if (cloudSave === 'saved') {
    return (
      <span className="topbar-savestate is-saved" title="All changes saved to the cloud">
        <Cloud size={13} aria-hidden /> Saved to cloud
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

// Compact save/sync status chip for the top-bar right cluster. Combines the (otherwise
// silent) local autosave state with the automatic cloud-save state, both read from the
// store. Live-collaboration status is shown separately by the collab pill in TopBar.
//
// When a cloud save fails the chip becomes a button: clicking it opens a dialog with the
// captured failure detail (e.g. a missing R2 CORS rule), so the error isn't a dead end.

import { useEffect, useState } from 'react';
import { Check, Cloud, CloudOff, Loader } from 'lucide-react';
import { useStore } from '../store/store';
import './StartDialog.css';

export function SaveStateIndicator() {
  const saveStatus = useStore((s) => s.saveStatus);
  const cloudSave = useStore((s) => s.cloudSave);
  const cloudSaveError = useStore((s) => s.cloudSaveError);
  const [detailOpen, setDetailOpen] = useState(false);

  if (saveStatus === 'saving' || cloudSave === 'saving') {
    return (
      <span className="topbar-savestate is-saving">
        <Loader size={13} aria-hidden className="spin" /> Saving…
      </span>
    );
  }

  if (cloudSave === 'error') {
    return (
      <>
        <button
          type="button"
          className="topbar-savestate is-error"
          title="Cloud save failed — click to see why"
          aria-haspopup="dialog"
          onClick={() => setDetailOpen(true)}
        >
          <CloudOff size={13} aria-hidden /> Cloud save failed
        </button>
        {detailOpen && (
          <CloudErrorDialog detail={cloudSaveError} onClose={() => setDetailOpen(false)} />
        )}
      </>
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

function CloudErrorDialog({ detail, onClose }: { detail: string | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog" onPointerDown={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="dialog-head">
          <h2>Cloud save failed</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="muted" style={{ margin: '12px 16px 0' }}>
          Your work is still saved locally on this device. The most recent attempt to save to the
          cloud failed with:
        </p>
        <div
          className="dialog-notice"
          style={{ whiteSpace: 'pre-wrap', userSelect: 'text', cursor: 'text' }}
        >
          {detail || 'No further detail was captured.'}
        </div>
        <p className="muted" style={{ margin: '0 16px 14px', fontSize: 12 }}>
          The app retries automatically on your next edit.
        </p>
      </div>
    </div>
  );
}

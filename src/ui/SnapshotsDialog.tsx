// Snapshot history: list a cloud set's saved snapshots (newest first) and open any one.
// Snapshots are immutable, so opening an older one and saving creates a new snapshot.

import { useCallback, useEffect, useState } from 'react';
import './StartDialog.css';
import { listSnapshots, type SnapshotInfo } from '../persistence/cloud';
import { openCloudProject } from '../persistence/cloudSync';

export function SnapshotsDialog({
  open,
  projectId,
  onClose,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
}) {
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [latest, setLatest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await listSnapshots(projectId);
      setSnapshots(r.snapshots);
      setLatest(r.latest);
    } catch (err) {
      setError(`Could not load history: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open && e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const openSnapshot = async (id: string) => {
    setError(null);
    try {
      await openCloudProject(projectId, { snapshot: id });
      onClose();
    } catch (err) {
      setError(`Could not open snapshot: ${(err as Error).message}`);
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog" onPointerDown={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="dialog-head">
          <h2>Snapshot history</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && <div className="dialog-notice">{error}</div>}

        <div className="project-list">
          {busy && snapshots.length === 0 && <div className="muted empty">Loading…</div>}
          {!busy && snapshots.length === 0 && !error && (
            <div className="muted empty">No snapshots yet.</div>
          )}
          {snapshots.map((s) => (
            <div className="project-row" key={s.id}>
              <button className="project-open" onClick={() => void openSnapshot(s.id)}>
                <span className="project-name">
                  {s.createdAt ? new Date(s.createdAt).toLocaleString() : s.id}
                  {s.id === latest ? ' · latest' : ''}
                </span>
                <span className="project-meta muted">{s.id}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

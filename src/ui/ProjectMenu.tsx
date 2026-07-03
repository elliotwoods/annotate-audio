// Project menu — the hub opened by clicking the project name in the top bar. Replaces the
// old row of New/Open/Import/Export/Save-to-cloud/Snapshots buttons with a single panel:
// rename, file actions, cloud status (publish / auto-save), recent snapshots, and recent
// projects. Full management still lives in StartDialog ("Open library…") and
// SnapshotsDialog ("All snapshots…"), which this links out to.
//
// Portalled + positioned like TempoPopover (the toolbar clips overflow, so an in-flow
// panel would be cut off); a transparent backdrop and Escape close it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  FilePlus,
  FolderOpen,
  Upload,
  Download,
  UploadCloud,
  History,
  Cloud,
  Check,
} from 'lucide-react';
import { useStore } from '../store/store';
import { useProjectName, useProjectId } from '../store/selectors';
import { startNewProject, loadProjectWithAudio } from '../audio/audioFile';
import { saveCurrentToCloud, openCloudProject } from '../persistence/cloudSync';
import { listProjects } from '../persistence/db';
import {
  listCloudProjects,
  listSnapshots,
  type SnapshotInfo,
  type CloudProjectSummary,
} from '../persistence/cloud';
import { isVerified, getProjectTokens } from '../auth/session';
import { refreshCollab } from '../hooks/useCollab';
import { reflectShareUrl } from '../auth/shareUrl';
import { emitCloudChanged } from '../auth/cloudSignal';
import type { Project } from '../model/types';
import './ProjectMenu.css';

const PANEL_WIDTH = 320;
const RECENT_LIMIT = 4;
const SNAPSHOT_LIMIT = 4;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error.';
}

export function ProjectMenu({
  onImport,
  onExport,
  onOpenLibrary,
  onOpenSnapshots,
  onCloudChanged,
}: {
  onImport: () => void;
  onExport: () => void;
  onOpenLibrary: () => void;
  onOpenSnapshots: () => void;
  /** Notify the parent that cloud access changed (e.g. first publish), so its right-cluster
   *  controls (Share / view-only) recompute. */
  onCloudChanged?: () => void;
}) {
  const name = useProjectName();
  const projectId = useProjectId();
  const setProjectName = useStore((s) => s.setProjectName);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const [tick, setTick] = useState(0); // recompute cloud access after a publish
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cloudProjects, setCloudProjects] = useState<CloudProjectSummary[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [latest, setLatest] = useState<string | null>(null);

  const cloud = useMemo(() => {
    const verified = isVerified();
    const tokens = getProjectTokens(projectId);
    const isCloud = !!(tokens.view || tokens.edit);
    // Editing requires sign-in: a cloud set needs login + the edit token; a still-local draft
    // is editable by the signed-in author.
    const editable = isCloud ? verified && !!tokens.edit : verified;
    return { verified, isCloud, editable, viewOnly: isCloud && !editable };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, tick]);

  const place = useCallback(() => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - PANEL_WIDTH - 8));
    setPos({ top: r.bottom + 6, left });
  }, []);

  const refresh = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch {
      setProjects([]);
    }
    if (isVerified()) {
      try {
        setCloudProjects(await listCloudProjects());
      } catch {
        setCloudProjects([]);
      }
    } else {
      setCloudProjects([]);
    }
    const tokens = getProjectTokens(projectId);
    if (tokens.view || tokens.edit) {
      try {
        const r = await listSnapshots(projectId);
        setSnapshots(r.snapshots);
        setLatest(r.latest);
      } catch {
        setSnapshots([]);
        setLatest(null);
      }
    } else {
      setSnapshots([]);
      setLatest(null);
    }
  }, [projectId]);

  const toggle = useCallback(() => {
    setOpen((o) => {
      if (!o) {
        place();
        setNotice(null);
        void refresh();
      }
      return !o;
    });
  }, [place, refresh]);

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

  // ── actions ────────────────────────────────────────────────────────────────
  const doNew = () => {
    startNewProject();
    close();
  };

  const openLocal = async (p: Project) => {
    setNotice(null);
    const ready = await loadProjectWithAudio(p);
    if (!ready && p.audio) {
      setNotice(`Opened "${p.name}". Audio isn't cached — use Load audio to relink.`);
      return;
    }
    close();
  };

  const openCloud = async (id: string) => {
    setNotice(null);
    try {
      await openCloudProject(id);
      close();
    } catch (err) {
      setNotice(`Could not open: ${errorMessage(err)}`);
    }
  };

  const openSnapshot = async (id: string) => {
    setNotice(null);
    try {
      await openCloudProject(projectId, { snapshot: id });
      close();
    } catch (err) {
      setNotice(`Could not open snapshot: ${errorMessage(err)}`);
    }
  };

  // Publish (first cloud save) OR an explicit checkpoint of an existing cloud set.
  const saveCloud = async () => {
    setBusy(true);
    setNotice(null);
    useStore.getState().setCloudSave('saving');
    try {
      const r = await saveCurrentToCloud();
      useStore.getState().setCloudSave('saved', { at: Date.now() });
      refreshCollab();
      emitCloudChanged();
      reflectShareUrl(projectId);
      setTick((t) => t + 1);
      onCloudChanged?.();
      await refresh();
      setNotice(r.created ? 'Published — your page URL is now a live edit link.' : 'Snapshot saved.');
    } catch (err) {
      useStore.getState().setCloudSave('error', { error: errorMessage(err) });
      setNotice(`Cloud save failed: ${errorMessage(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const recentLocal = projects.filter((p) => p.id !== projectId).slice(0, RECENT_LIMIT);
  const recentCloud = cloudProjects.filter((p) => p.id !== projectId).slice(0, RECENT_LIMIT);

  return (
    <div className="topbar-group">
      <button
        ref={btnRef}
        type="button"
        className="projectmenu-trigger"
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Project menu — rename, open, import/export, snapshots"
      >
        <span className="projectmenu-trigger-name">{name || 'Untitled project'}</span>
        <ChevronDown size={14} aria-hidden className="projectmenu-trigger-chev" />
      </button>

      {open &&
        createPortal(
          <>
            <div className="projectmenu-backdrop" onPointerDown={close} />
            <div
              className="projectmenu"
              role="dialog"
              aria-label="Project menu"
              style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {/* Rename */}
              <label className="projectmenu-field">
                <span className="projectmenu-field-label">Name</span>
                <input
                  type="text"
                  value={name}
                  placeholder="Untitled project"
                  aria-label="Project name"
                  onChange={(e) => setProjectName(e.target.value)}
                />
              </label>

              <div className="projectmenu-divider" />

              {/* File actions. New/Import create or replace the current set, so they're for
                  signed-in users only — a share-link guest can only view/edit the shared set. */}
              <div className="projectmenu-actions">
                {cloud.verified && (
                  <button type="button" className="ghost" onClick={doNew}>
                    <FilePlus size={15} aria-hidden /> New
                  </button>
                )}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    onOpenLibrary();
                    close();
                  }}
                >
                  <FolderOpen size={15} aria-hidden /> Open library…
                </button>
                {cloud.verified && (
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      onImport();
                      close();
                    }}
                  >
                    <Upload size={15} aria-hidden /> Import
                  </button>
                )}
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    onExport();
                    close();
                  }}
                >
                  <Download size={15} aria-hidden /> Export
                </button>
              </div>

              <div className="projectmenu-divider" />

              {/* Cloud. Saving is automatic — there is no "Save to cloud" button; the only
                  manual control is an explicit snapshot checkpoint. */}
              <div className="projectmenu-cloud">
                {cloud.editable && cloud.isCloud && (
                  <>
                    <span className="projectmenu-cloud-status">
                      <Check size={14} aria-hidden /> Auto-saving to the cloud
                    </span>
                    <button type="button" className="ghost" onClick={() => void saveCloud()} disabled={busy}>
                      <UploadCloud size={15} aria-hidden /> {busy ? 'Saving…' : 'Save snapshot now'}
                    </button>
                  </>
                )}
                {cloud.editable && !cloud.isCloud && (
                  <span className="projectmenu-cloud-status muted">
                    <Cloud size={14} aria-hidden /> Saves to the cloud automatically once it has content
                  </span>
                )}
                {cloud.viewOnly && (
                  <span className="projectmenu-cloud-status muted">
                    <Cloud size={14} aria-hidden /> View-only — sign in to edit
                  </span>
                )}
              </div>

              {notice && <div className="projectmenu-notice">{notice}</div>}

              {/* Snapshots */}
              {cloud.isCloud && (
                <>
                  <div className="projectmenu-divider" />
                  <div className="projectmenu-section">
                    <div className="projectmenu-section-head">
                      <span>Snapshots</span>
                      <button
                        type="button"
                        className="ghost projectmenu-link"
                        onClick={() => {
                          onOpenSnapshots();
                          close();
                        }}
                      >
                        <History size={13} aria-hidden /> All…
                      </button>
                    </div>
                    {snapshots.length === 0 && <div className="projectmenu-empty">No snapshots yet.</div>}
                    {snapshots.slice(0, SNAPSHOT_LIMIT).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="projectmenu-row"
                        onClick={() => void openSnapshot(s.id)}
                      >
                        <span className="projectmenu-row-name">
                          {s.createdAt ? new Date(s.createdAt).toLocaleString() : s.id}
                          {s.id === latest ? ' · latest' : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Recent projects */}
              {(recentLocal.length > 0 || recentCloud.length > 0) && (
                <>
                  <div className="projectmenu-divider" />
                  <div className="projectmenu-section">
                    <div className="projectmenu-section-head">
                      <span>Recent</span>
                    </div>
                    {recentLocal.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="projectmenu-row"
                        onClick={() => void openLocal(p)}
                      >
                        <span className="projectmenu-row-name">{p.name || 'Untitled'}</span>
                        <span className="projectmenu-row-meta muted">
                          {new Date(p.updatedAt).toLocaleDateString()}
                        </span>
                      </button>
                    ))}
                    {recentCloud.map((p) => (
                      <button
                        key={`cloud-${p.id}`}
                        type="button"
                        className="projectmenu-row"
                        onClick={() => void openCloud(p.id)}
                      >
                        <span className="projectmenu-row-name">{p.name || 'Untitled'}</span>
                        <span className="projectmenu-row-meta muted">cloud</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}

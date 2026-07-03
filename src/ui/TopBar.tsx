// TopBar (spec §7, §13.1, §14): the project menu (rename / file ops / cloud / snapshots),
// audio loading, the manual grid controls (BpmControls), tempo tools, and a right-hand
// cluster for sound / live status / sharing / account. File and project management now live
// in ProjectMenu (opened from the project name); cloud saving is automatic
// (persistence/cloudAutosave). All persistence/audio side effects surface a clear,
// non-silent error (spec §8.1).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FileMusic,
  CircleAlert,
  Magnet,
  Share2,
  LogIn,
  UserCheck,
  Volume2,
  VolumeX,
  Radio,
  Users,
  Undo2,
  Redo2,
} from 'lucide-react';
import { useStore as useZustand } from 'zustand';
import { useStore, undo, redo, temporalStore } from '../store/store';
import { useProjectId } from '../store/selectors';
import { loadAudioFile, loadProjectWithAudio, relinkAudioFile } from '../audio/audioFile';
import { AudioDecodeError } from '../audio/AudioEngine';
import { exportProjectToFile, importProjectFromFile } from '../persistence/json';
import { isVerified, getProjectTokens } from '../auth/session';
import { emitCloudChanged, onCloudChanged } from '../auth/cloudSignal';
import { refreshCollab, type CollabState } from '../hooks/useCollab';
import { useSoundToggle } from '../hooks/useSoundToggle';
import { BpmControls } from './BpmControls';
import { TempoPopover } from './TempoPopover';
import { ProjectMenu } from './ProjectMenu';
import { HistoryMenu } from './HistoryMenu';
import { LoginDialog } from './LoginDialog';
import { AdminPanel } from './AdminPanel';
import { ShareDialog } from './ShareDialog';
import { SnapshotsDialog } from './SnapshotsDialog';
import { SaveStateIndicator } from './SaveStateIndicator';
import './TopBar.css';

const AUDIO_ACCEPT = '.flac,.ogg,.m4a,audio/*';

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error.';
}

/** Short label for the live-collaboration pill (e.g. "Live · 2" = you + one other). */
function collabPillLabel(collab: CollabState): string {
  switch (collab.status) {
    case 'open':
      return `Live · ${collab.peerCount + 1}`;
    case 'connecting':
      return 'Connecting…';
    default:
      return 'Offline';
  }
}

function collabPillTitle(collab: CollabState): string {
  switch (collab.status) {
    case 'open':
      return collab.peerCount === 0
        ? 'Live — no other editors connected'
        : `Live — ${collab.peerCount} other ${collab.peerCount === 1 ? 'editor' : 'editors'} connected`;
    case 'connecting':
      return 'Connecting to the live session…';
    default:
      return 'Live editing is unavailable for this session';
  }
}

export function TopBar({
  onOpenLibrary,
  collab,
}: {
  onOpenLibrary: () => void;
  collab: CollabState;
}) {
  const projectId = useProjectId();
  const resnapAllToGrid = useStore((s) => s.resnapAllToGrid);
  const { muted, toggle: toggleSound } = useSoundToggle();

  const canUndo = useZustand(temporalStore, (t) => t.pastStates.length > 0);
  const canRedo = useZustand(temporalStore, (t) => t.futureStates.length > 0);

  const importInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  // When importing a project whose audio isn't cached, the next "Load audio" acts as a
  // relink for this hash (spec §13.1) rather than a fresh load.
  const [pendingRelink, setPendingRelink] = useState<string | null>(null);

  // ── cloud (sharing / view-only / verified access) ──────────────────────────
  // `cloudTick` bumps to recompute access after login or a publish mutates session state.
  const [cloudTick, setCloudTick] = useState(0);
  const [loginOpen, setLoginOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);

  const cloud = useMemo(() => {
    const verified = isVerified();
    const tokens = getProjectTokens(projectId);
    const isCloud = !!(tokens.view || tokens.edit);
    // Editing requires sign-in: a cloud set needs login + the edit token (owners/invited
    // editors); a still-local draft is editable by the signed-in author.
    const editable = isCloud ? verified && !!tokens.edit : verified;
    // Holds an edit invite but isn't signed in yet → can unlock editing by signing in.
    const invited = isCloud && !editable && !!tokens.edit && !verified;
    return { verified, isCloud, editable, invited, viewOnly: isCloud && !editable };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, cloudTick]);

  // Auto-publishing a set (or signing in/out) changes cloud access without changing the project
  // id, so recompute the `cloud` memo whenever the shared signal fires — this is what makes the
  // Share button appear the moment a fresh set reaches the cloud.
  useEffect(() => onCloudChanged(() => setCloudTick((t) => t + 1)), []);

  const handleExport = useCallback(() => {
    setError(null);
    try {
      exportProjectToFile(useStore.getState().exportProject());
    } catch (err) {
      setError(`Export failed: ${errorMessage(err)}`);
    }
  }, []);

  // Core load logic, reused by the file input AND drag-and-drop.
  const importProject = useCallback(async (file: File) => {
    setError(null);
    setPendingRelink(null);
    try {
      const project = await importProjectFromFile(file);
      const ready = await loadProjectWithAudio(project);
      if (!ready && project.audio) {
        // Audio referenced but not cached → prompt to relink via the Load-audio button.
        setPendingRelink(project.audio.hash);
        setError(
          `Imported "${project.name}". Audio "${project.audio.fileName}" isn't cached — click "Locate audio" to restore the waveform.`,
        );
      }
    } catch (err) {
      setError(`Could not import "${file.name}": ${errorMessage(err)}`);
    }
  }, []);

  const loadAudio = useCallback(
    async (file: File) => {
      setError(null);
      setAudioBusy(true);
      try {
        if (pendingRelink) {
          const { matched } = await relinkAudioFile(file, pendingRelink);
          setPendingRelink(null);
          if (!matched) {
            setError("Located file doesn't match the project's original audio (hash mismatch).");
          }
        } else {
          await loadAudioFile(file);
        }
      } catch (err) {
        if (err instanceof AudioDecodeError) {
          setError(`Could not load ${err.format}: ${err.message}`);
        } else {
          setError(`Could not load "${file.name}": ${errorMessage(err)}`);
        }
      } finally {
        setAudioBusy(false);
      }
    },
    [pendingRelink],
  );

  /** Route a file (from input or drop): `.json` → import project, else → load as audio. */
  const handleFile = useCallback(
    (file: File) => {
      const isJson =
        file.type === 'application/json' || /\.(cuetl\.)?json$/i.test(file.name);
      return isJson ? importProject(file) : loadAudio(file);
    },
    [importProject, loadAudio],
  );

  const handleImportChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // allow re-selecting the same file
      if (file) await importProject(file);
    },
    [importProject],
  );

  const handleAudioChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) await loadAudio(file);
    },
    [loadAudio],
  );

  // ── drag-and-drop (anywhere on the window) ────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) =>
      !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setIsDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const reset = () => {
      depth = 0;
      setIsDragging(false);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // relatedTarget === null means the pointer left the document entirely.
      if (e.relatedTarget === null) return reset();
      depth = Math.max(0, depth - 1);
      if (depth === 0) setIsDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      const file = e.dataTransfer?.files?.[0];
      // Swallow any file drop so the browser never navigates to it, then load it.
      // (Don't gate on dataTransfer.types — it's unreliable on the drop event.)
      if (file) {
        e.preventDefault();
        void handleFile(file);
      }
      depth = 0;
      setIsDragging(false);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    // ESC-cancel / drag aborted without a drop → clear the overlay.
    window.addEventListener('dragend', reset);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', reset);
    };
  }, [handleFile]);

  return (
    <header className="topbar" style={{ height: 'var(--topbar-h)' }}>
      <ProjectMenu
        onImport={() => importInputRef.current?.click()}
        onExport={handleExport}
        onOpenLibrary={onOpenLibrary}
        onOpenSnapshots={() => setSnapshotsOpen(true)}
        onCloudChanged={() => setCloudTick((t) => t + 1)}
      />

      <div className="divider" />

      <div className="topbar-group">
        <button
          type="button"
          className="ghost icon"
          onClick={() => undo()}
          disabled={!canUndo}
          title="Undo — Ctrl+Z"
          aria-label="Undo"
        >
          <Undo2 size={15} aria-hidden />
        </button>
        <button
          type="button"
          className="ghost icon"
          onClick={() => redo()}
          disabled={!canRedo}
          title="Redo — Ctrl+Shift+Z"
          aria-label="Redo"
        >
          <Redo2 size={15} aria-hidden />
        </button>
        <HistoryMenu />
      </div>

      <div className="divider" />

      <div className={`topbar-group topbar-audio${isDragging ? ' dropping' : ''}`}>
        <button
          type="button"
          className="load-audio-btn"
          onClick={() => audioInputRef.current?.click()}
          disabled={audioBusy}
          title={
            pendingRelink
              ? 'Locate the project’s audio file to restore the waveform'
              : 'Load an audio file (FLAC / OGG / M4A) — or drag one anywhere'
          }
        >
          <FileMusic size={15} aria-hidden />{' '}
          {audioBusy
            ? 'Loading…'
            : isDragging
              ? 'Drop to load'
              : pendingRelink
                ? 'Locate audio'
                : 'Load audio'}
        </button>
      </div>

      <div className="divider" />

      <BpmControls />

      <button
        type="button"
        className="ghost icon topbar-resnap"
        onClick={() => resnapAllToGrid()}
        title="Re-snap all — pull every block onto the current grid"
        aria-label="Re-snap all blocks to the grid"
      >
        <Magnet size={15} aria-hidden />
      </button>

      <div className="divider" />

      <TempoPopover />

      <div className="spacer" />

      {error && (
        <div className="topbar-error" role="alert">
          <CircleAlert size={15} aria-hidden />
          <span>{error}</span>
          <button
            type="button"
            className="ghost icon topbar-error-dismiss"
            aria-label="Dismiss error"
            onClick={() => setError(null)}
          >
            ×
          </button>
        </div>
      )}

      {/* Right cluster: per-user output + live status + sharing + account. */}
      <div className="topbar-group topbar-right">
        <button
          type="button"
          className={`ghost icon topbar-sound-btn${muted ? ' is-muted' : ''}`}
          onClick={toggleSound}
          aria-pressed={muted}
          title={muted ? 'Sound output muted — click to unmute' : 'Mute sound output (this device only)'}
        >
          {muted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
        </button>

        {collab.enabled && (
          <button
            type="button"
            className={`ghost icon topbar-sync-btn${collab.syncPlayback ? ' active' : ''}`}
            onClick={() => collab.setSyncPlayback(!collab.syncPlayback)}
            aria-pressed={collab.syncPlayback}
            title={
              collab.syncPlayback
                ? 'Sync playback on — your play/seek follows (and drives) collaborators who also enable it'
                : 'Sync playback off — playback is independent on this device'
            }
          >
            <Radio size={16} aria-hidden />
          </button>
        )}

        <SaveStateIndicator />

        {collab.enabled && (
          <span
            className={`topbar-collab-pill status-${collab.status}`}
            title={collabPillTitle(collab)}
          >
            <Users size={13} aria-hidden /> {collabPillLabel(collab)}
          </span>
        )}

        {cloud.viewOnly && !cloud.invited && (
          <span className="topbar-pill" title="Opened from a view-only link">
            View-only
          </span>
        )}

        {cloud.invited && (
          <button
            type="button"
            className="topbar-pill topbar-pill--action"
            onClick={() => setLoginOpen(true)}
            title="This is an edit invite — sign in to edit this set"
          >
            Sign in to edit
          </button>
        )}

        {cloud.isCloud && (
          <button
            type="button"
            className="ghost icon"
            onClick={() => setShareOpen(true)}
            title="Get shareable links for this set"
            aria-label="Share"
          >
            <Share2 size={15} aria-hidden />
          </button>
        )}

        <button
          type="button"
          className="ghost"
          onClick={() => setLoginOpen(true)}
          title={cloud.verified ? 'Verified — manage access' : 'Sign in to create cloud projects'}
        >
          {cloud.verified ? <UserCheck size={15} aria-hidden /> : <LogIn size={15} aria-hidden />}{' '}
          {cloud.verified ? 'Verified' : 'Sign in'}
        </button>
      </div>

      {/* Hidden file inputs driven by ProjectMenu / Load-audio. */}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,.cuetl.json,application/json"
        className="visually-hidden"
        onChange={handleImportChange}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept={AUDIO_ACCEPT}
        className="visually-hidden"
        onChange={handleAudioChange}
      />

      {isDragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-inner">
            <FileMusic size={28} aria-hidden />
            <div className="drop-overlay-title">
              {pendingRelink ? 'Drop the audio file to relink' : 'Drop to load audio'}
            </div>
            <div className="drop-overlay-sub">FLAC · OGG · M4A — or a .cuetl.json project</div>
          </div>
        </div>
      )}

      <LoginDialog
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onOpenAdmin={() => {
          setLoginOpen(false);
          setAdminOpen(true);
        }}
        onChange={() => {
          // Signing in/out changes cloud access app-wide: refresh live collab, recompute this
          // bar's access memo (via the subscription above), and let App re-gate the editor.
          emitCloudChanged();
          refreshCollab();
        }}
      />
      <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} />
      <ShareDialog open={shareOpen} projectId={projectId} onClose={() => setShareOpen(false)} />
      <SnapshotsDialog
        open={snapshotsOpen}
        projectId={projectId}
        onClose={() => setSnapshotsOpen(false)}
      />
    </header>
  );
}

// TopBar (spec §7, §13.1, §14): project name, New/Open, Import/Export JSON,
// Load audio, then the manual grid controls (BpmControls) and the auto-detect
// suggestion panel (DetectPanel). All persistence/audio side effects surface a
// clear, non-silent error (spec §8.1).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FilePlus,
  FolderOpen,
  Upload,
  Download,
  FileMusic,
  CircleAlert,
  Magnet,
  UploadCloud,
  Share2,
  History,
  LogIn,
  UserCheck,
  Volume2,
  VolumeX,
  Radio,
  Users,
} from 'lucide-react';
import { useStore } from '../store/store';
import { useProjectName, useProjectId } from '../store/selectors';
import {
  loadAudioFile,
  startNewProject,
  loadProjectWithAudio,
  relinkAudioFile,
} from '../audio/audioFile';
import { AudioDecodeError } from '../audio/AudioEngine';
import { exportProjectToFile, importProjectFromFile } from '../persistence/json';
import { saveCurrentToCloud } from '../persistence/cloudSync';
import { isVerified, getProjectTokens } from '../auth/session';
import { refreshCollab, type CollabState } from '../hooks/useCollab';
import { useSoundToggle } from '../hooks/useSoundToggle';
import { BpmControls } from './BpmControls';
import { TempoPopover } from './TempoPopover';
import { LoginDialog } from './LoginDialog';
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
  const name = useProjectName();
  const projectId = useProjectId();
  const setProjectName = useStore((s) => s.setProjectName);
  const resnapAllToGrid = useStore((s) => s.resnapAllToGrid);
  const { muted, toggle: toggleSound } = useSoundToggle();

  const importInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  // When importing a project whose audio isn't cached, the next "Load audio" acts as a
  // relink for this hash (spec §13.1) rather than a fresh load.
  const [pendingRelink, setPendingRelink] = useState<string | null>(null);

  // ── cloud (sharing / snapshots / verified access) ──────────────────────────
  // `cloudTick` bumps to recompute access after login or a save mutates session state.
  const [cloudTick, setCloudTick] = useState(0);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMsg, setCloudMsg] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);

  const cloud = useMemo(() => {
    const verified = isVerified();
    const tokens = getProjectTokens(projectId);
    const isCloud = !!(tokens.view || tokens.edit);
    const editable = verified || !!tokens.edit; // admin edits any set; edit-token holders too
    return { verified, isCloud, editable, viewOnly: isCloud && !editable };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, cloudTick]);

  const handleSaveCloud = useCallback(async () => {
    setError(null);
    setCloudMsg(null);
    setCloudBusy(true);
    try {
      const r = await saveCurrentToCloud();
      setCloudTick((t) => t + 1);
      // First save grants tokens → let the collab hook (re)join the live session.
      refreshCollab();
      setCloudMsg(r.created ? 'Saved to cloud — open Share for links.' : 'New snapshot saved.');
    } catch (err) {
      setError(`Cloud save failed: ${errorMessage(err)}`);
    } finally {
      setCloudBusy(false);
    }
  }, []);

  // Auto-clear the transient success note.
  useEffect(() => {
    if (!cloudMsg) return;
    const t = setTimeout(() => setCloudMsg(null), 4000);
    return () => clearTimeout(t);
  }, [cloudMsg]);

  const handleExport = useCallback(() => {
    setError(null);
    try {
      exportProjectToFile(useStore.getState().exportProject());
    } catch (err) {
      setError(`Export failed: ${errorMessage(err)}`);
    }
  }, []);

  // Core load logic, reused by the file inputs AND drag-and-drop.
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
      <input
        className="topbar-name"
        type="text"
        value={name}
        aria-label="Project name"
        placeholder="Untitled project"
        onChange={(e) => setProjectName(e.target.value)}
      />

      <div className="divider" />

      <div className="topbar-group">
        <button type="button" className="ghost" onClick={() => startNewProject()} title="New project">
          <FilePlus size={15} aria-hidden /> New
        </button>
        <button type="button" className="ghost" onClick={onOpenLibrary} title="Open project">
          <FolderOpen size={15} aria-hidden /> Open
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => importInputRef.current?.click()}
          title="Import a .cuetl.json project file"
        >
          <Upload size={15} aria-hidden /> Import
        </button>
        <button
          type="button"
          className="ghost"
          onClick={handleExport}
          title="Export this project as JSON"
        >
          <Download size={15} aria-hidden /> Export
        </button>
      </div>

      <div className="divider" />

      <div className="topbar-group">
        {cloud.editable && (
          <button
            type="button"
            className="ghost"
            onClick={() => void handleSaveCloud()}
            disabled={cloudBusy}
            title="Save a new snapshot to the cloud (never overwrites previous saves)"
          >
            <UploadCloud size={15} aria-hidden /> {cloudBusy ? 'Saving…' : 'Save to cloud'}
          </button>
        )}
        {cloud.isCloud && (
          <button
            type="button"
            className="ghost"
            onClick={() => setSnapshotsOpen(true)}
            title="Browse and open saved snapshots"
          >
            <History size={15} aria-hidden /> Snapshots
          </button>
        )}
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

      <div className="topbar-group">
        <button
          type="button"
          className="ghost"
          onClick={() => resnapAllToGrid()}
          title="Pull every block onto the current grid (does not change stored audio positions until applied)"
        >
          <Magnet size={15} aria-hidden /> Re-snap all
        </button>
      </div>

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

        <SaveStateIndicator cloudBusy={cloudBusy} cloudMsg={cloudMsg} />

        {collab.enabled && (
          <span
            className={`topbar-collab-pill status-${collab.status}`}
            title={collabPillTitle(collab)}
          >
            <Users size={13} aria-hidden /> {collabPillLabel(collab)}
          </span>
        )}

        {cloud.viewOnly && (
          <span className="topbar-pill" title="Opened from a view-only link">
            View-only
          </span>
        )}

        {cloud.isCloud && (
          <button
            type="button"
            className="ghost"
            onClick={() => setShareOpen(true)}
            title="Get shareable links for this set"
          >
            <Share2 size={15} aria-hidden /> Share
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

      {/* Hidden file inputs driven by the buttons above. */}
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
        onChange={() => {
          setCloudTick((t) => t + 1);
          refreshCollab();
        }}
      />
      <ShareDialog open={shareOpen} projectId={projectId} onClose={() => setShareOpen(false)} />
      <SnapshotsDialog
        open={snapshotsOpen}
        projectId={projectId}
        onClose={() => setSnapshotsOpen(false)}
      />
    </header>
  );
}

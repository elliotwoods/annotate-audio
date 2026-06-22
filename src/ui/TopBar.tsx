// TopBar (spec §7, §13.1, §14): project name, New/Open, Import/Export JSON,
// Load audio, then the manual grid controls (BpmControls) and the auto-detect
// suggestion panel (DetectPanel). All persistence/audio side effects surface a
// clear, non-silent error (spec §8.1).

import { useCallback, useRef, useState } from 'react';
import {
  FilePlus,
  FolderOpen,
  Upload,
  Download,
  FileMusic,
  CircleAlert,
  Magnet,
} from 'lucide-react';
import { useStore } from '../store/store';
import { useProjectName } from '../store/selectors';
import {
  loadAudioFile,
  startNewProject,
  loadProjectWithAudio,
  relinkAudioFile,
} from '../audio/audioFile';
import { AudioDecodeError } from '../audio/AudioEngine';
import { exportProjectToFile, importProjectFromFile } from '../persistence/json';
import { BpmControls } from './BpmControls';
import { DetectPanel } from './DetectPanel';
import './TopBar.css';

const AUDIO_ACCEPT = '.flac,.ogg,.m4a,audio/*';

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error.';
}

export function TopBar({ onOpenLibrary }: { onOpenLibrary: () => void }) {
  const name = useProjectName();
  const setProjectName = useStore((s) => s.setProjectName);
  const resnapAllToGrid = useStore((s) => s.resnapAllToGrid);

  const importInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [audioBusy, setAudioBusy] = useState(false);
  // When importing a project whose audio isn't cached, the next "Load audio" acts as a
  // relink for this hash (spec §13.1) rather than a fresh load.
  const [pendingRelink, setPendingRelink] = useState<string | null>(null);

  const handleExport = useCallback(() => {
    setError(null);
    try {
      exportProjectToFile(useStore.getState().exportProject());
    } catch (err) {
      setError(`Export failed: ${errorMessage(err)}`);
    }
  }, []);

  const handleImportChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ''; // allow re-selecting the same file
      if (!file) return;
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
    },
    [],
  );

  const handleAudioChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
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
        <button
          type="button"
          onClick={() => audioInputRef.current?.click()}
          disabled={audioBusy}
          title={
            pendingRelink
              ? 'Locate the project’s audio file to restore the waveform'
              : 'Load an audio file (FLAC / OGG / M4A)'
          }
        >
          <FileMusic size={15} aria-hidden />{' '}
          {audioBusy ? 'Loading…' : pendingRelink ? 'Locate audio' : 'Load audio'}
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

      <DetectPanel />

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
    </header>
  );
}

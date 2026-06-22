// Recent-projects / New / Open dialog + storage management (spec §13.2).

import { useCallback, useEffect, useRef, useState } from 'react';
import './StartDialog.css';
import { useProjectId } from '../store/selectors';
import {
  listProjects,
  deleteProject,
  clearAllAudio,
  estimateStorage,
  getAudioBlob,
} from '../persistence/db';
import { importProjectFromFile } from '../persistence/json';
import { startNewProject, loadProjectWithAudio, relinkAudioFile } from '../audio/audioFile';
import type { Project } from '../model/types';

export function StartDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const currentId = useProjectId();
  const [projects, setProjects] = useState<Project[]>([]);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [relinkFor, setRelinkFor] = useState<Project | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const relinkRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    setProjects(await listProjects());
    setStorage(await estimateStorage());
  }, []);

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

  const openProject = async (p: Project) => {
    setNotice(null);
    const ready = await loadProjectWithAudio(p);
    if (!ready && p.audio) {
      setRelinkFor(p);
      setNotice(`Audio "${p.audio.fileName}" isn't cached. Locate the file to restore the waveform.`);
      return; // keep dialog open so the user can relink
    }
    onClose();
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const p = await importProjectFromFile(file);
      await openProject(p);
      await refresh();
    } catch (err) {
      setNotice(`Import failed: ${(err as Error).message}`);
    }
  };

  const onRelink = async (file: File | undefined) => {
    if (!file || !relinkFor?.audio) return;
    const { matched } = await relinkAudioFile(file, relinkFor.audio.hash);
    setNotice(matched ? null : 'Warning: this file does not match the project’s original audio (hash mismatch).');
    setRelinkFor(null);
    onClose();
  };

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog" onPointerDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2>Projects</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="dialog-actions">
          <button
            className="primary"
            onClick={() => {
              startNewProject();
              onClose();
            }}
          >
            New project
          </button>
          <button onClick={() => importRef.current?.click()}>Import JSON…</button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => void onImport(e.target.files?.[0])}
          />
        </div>

        {notice && <div className="dialog-notice">{notice}</div>}
        {relinkFor && (
          <div className="dialog-actions">
            <button onClick={() => relinkRef.current?.click()}>Locate audio file…</button>
            <input
              ref={relinkRef}
              type="file"
              accept=".flac,.ogg,.m4a,audio/*"
              hidden
              onChange={(e) => void onRelink(e.target.files?.[0])}
            />
          </div>
        )}

        <div className="project-list">
          {projects.length === 0 && <div className="muted empty">No saved projects yet.</div>}
          {projects.map((p) => (
            <ProjectRow
              key={p.id}
              p={p}
              current={p.id === currentId}
              onOpen={() => void openProject(p)}
              onDelete={async () => {
                await deleteProject(p.id);
                await refresh();
              }}
            />
          ))}
        </div>

        <div className="dialog-foot">
          {storage && (
            <span className="muted">
              Storage: {(storage.usage / 1e6).toFixed(1)} MB used
              {storage.quota ? ` of ${(storage.quota / 1e6).toFixed(0)} MB` : ''}
            </span>
          )}
          <button
            className="ghost"
            onClick={async () => {
              if (window.confirm('Clear all cached audio blobs? Projects keep their cues; you’ll need to re-import audio.')) {
                await clearAllAudio();
                await refresh();
              }
            }}
          >
            Clear cached audio
          </button>
        </div>
      </div>
    </div>
  );
}

function ProjectRow({
  p,
  current,
  onOpen,
  onDelete,
}: {
  p: Project;
  current: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [hasAudio, setHasAudio] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    if (p.audio) {
      void getAudioBlob(p.audio.hash).then((b) => alive && setHasAudio(!!b));
    } else {
      setHasAudio(null);
    }
    return () => {
      alive = false;
    };
  }, [p.audio]);

  return (
    <div className={`project-row${current ? ' current' : ''}`}>
      <button className="project-open" onClick={onOpen}>
        <span className="project-name">{p.name || 'Untitled'}</span>
        <span className="project-meta muted">
          {new Date(p.updatedAt).toLocaleString()} · {p.blocks.length} cues
          {p.audio ? (hasAudio ? ' · audio cached' : ' · audio missing') : ' · no audio'}
        </span>
      </button>
      <button className="ghost icon danger-hover" onClick={onDelete} aria-label="Delete project">
        🗑
      </button>
    </div>
  );
}

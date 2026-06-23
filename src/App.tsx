import { useEffect, useState } from 'react';
import './App.css';
import { TopBar } from './ui/TopBar';
import { Timeline } from './ui/Timeline';
import { Transport } from './ui/Transport';
import { StartDialog } from './ui/StartDialog';
import { useKeyboard } from './hooks/useKeyboard';
import { useCollab } from './hooks/useCollab';
import { applyPersistedMute } from './hooks/useSoundToggle';
import { useProjectId } from './store/selectors';
import { startAutosave } from './persistence/autosave';
import { listProjects } from './persistence/db';
import { loadProjectWithAudio } from './audio/audioFile';
import { openCloudProject } from './persistence/cloudSync';
import { rememberTokens } from './auth/session';

/** Parse a shared-link request from the URL: ?p=<id>&v=<viewToken>&e=<editToken>. */
function readShareLink(): { id: string; view?: string; edit?: string } | null {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('p');
  if (!id) return null;
  return { id, view: params.get('v') ?? undefined, edit: params.get('e') ?? undefined };
}

/** Drop the token params from the address bar (keep ?p=<id>) so they don't linger on screen. */
function stripTokensFromUrl(id: string): void {
  const clean = `${window.location.origin}${import.meta.env.BASE_URL}?p=${encodeURIComponent(id)}`;
  window.history.replaceState(null, '', clean);
}

export default function App() {
  const [startOpen, setStartOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  useKeyboard();

  // Live collaboration for the current (cloud) project.
  const projectId = useProjectId();
  const collab = useCollab(projectId);

  // Autosave for the whole session.
  useEffect(() => startAutosave(), []);

  // Apply the persisted per-device mute preference once on boot.
  useEffect(() => applyPersistedMute(), []);

  // On boot: a shared link (?p=…) takes precedence; otherwise reopen the most recent local
  // project, else offer the start dialog.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const link = readShareLink();
      if (link) {
        // Persist any tokens from the link, then clean them out of the address bar.
        if (link.view) rememberTokens(link.id, { view: link.view });
        if (link.edit) rememberTokens(link.id, { edit: link.edit });
        stripTokensFromUrl(link.id);
        try {
          const r = await openCloudProject(link.id);
          if (cancelled) return;
          if (!r.audioReady) {
            setBanner('Opened set, but its audio could not be loaded.');
          }
        } catch (err) {
          if (cancelled) return;
          setBanner(`Could not open the shared set: ${(err as Error).message}`);
        }
        return;
      }

      try {
        const recents = await listProjects();
        if (cancelled) return;
        if (recents.length > 0) {
          void loadProjectWithAudio(recents[0]);
        } else {
          setStartOpen(true);
        }
      } catch {
        /* no IndexedDB / first run — keep default project */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="app">
      <TopBar onOpenLibrary={() => setStartOpen(true)} collab={collab} />
      {banner && (
        <div className="app-banner" role="status">
          <span>{banner}</span>
          <button className="ghost icon" aria-label="Dismiss" onClick={() => setBanner(null)}>
            ×
          </button>
        </div>
      )}
      <Timeline />
      <Transport />
      <StartDialog open={startOpen} onClose={() => setStartOpen(false)} />
    </div>
  );
}

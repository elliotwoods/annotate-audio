import { useEffect, useState } from 'react';
import './App.css';
import { TopBar } from './ui/TopBar';
import { Timeline } from './ui/Timeline';
import { Transport } from './ui/Transport';
import { StartDialog } from './ui/StartDialog';
import { useKeyboard } from './hooks/useKeyboard';
import { useCollab } from './hooks/useCollab';
import { applyPersistedMute } from './hooks/useSoundToggle';
import { useProjectId, useHasShareableContent } from './store/selectors';
import { startAutosave } from './persistence/autosave';
import { startCloudAutosave } from './persistence/cloudAutosave';
import { listProjects } from './persistence/db';
import { loadProjectWithAudio } from './audio/audioFile';
import { openCloudProject } from './persistence/cloudSync';
import { rememberTokens } from './auth/session';
import { ensureShareableUrl } from './auth/shareUrl';

/** Parse a shared-link request from the URL: ?p=<id>&v=<viewToken>&e=<editToken>. */
function readShareLink(): { id: string; view?: string; edit?: string } | null {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('p');
  if (!id) return null;
  return { id, view: params.get('v') ?? undefined, edit: params.get('e') ?? undefined };
}

export default function App() {
  const [startOpen, setStartOpen] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  // Capture any incoming share link ONCE, synchronously during the first render, before the
  // url-reflection effect below can rewrite the address bar.
  const [bootLink] = useState(readShareLink);
  useKeyboard();

  // Live collaboration for the current (cloud) project.
  const projectId = useProjectId();
  const hasShareableContent = useHasShareableContent();
  const collab = useCollab(projectId);

  // Autosave for the whole session (local IndexedDB + automatic cloud snapshots).
  useEffect(() => startAutosave(), []);
  useEffect(() => startCloudAutosave(), []);

  // Apply the persisted per-device mute preference once on boot.
  useEffect(() => applyPersistedMute(), []);

  // Keep the address bar as a live edit link for the current project, so copy-pasting the URL
  // loads THIS project on another computer — not the recipient's own most-recent one. For a
  // still-local set, a verified user auto-publishes it to the cloud first so the link works.
  // Re-runs when the project changes OR first gains shareable content (audio/blocks), so a set
  // built up within one session also gets published once there's something to share.
  useEffect(() => {
    void ensureShareableUrl(projectId);
  }, [projectId, hasShareableContent]);

  // On boot: a shared link (?p=…) takes precedence; otherwise reopen the most recent local
  // project, else offer the start dialog.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const link = bootLink;
      if (link) {
        // Persist any tokens from the link. The url-reflection effect re-normalises the
        // address bar to the canonical share link once the project loads.
        if (link.view) rememberTokens(link.id, { view: link.view });
        if (link.edit) rememberTokens(link.id, { edit: link.edit });
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
  }, [bootLink]);

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

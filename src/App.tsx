import { useEffect, useState } from 'react';
import './App.css';
import { TopBar } from './ui/TopBar';
import { Timeline } from './ui/Timeline';
import { Transport } from './ui/Transport';
import { StartDialog } from './ui/StartDialog';
import { SignInGate } from './ui/SignInGate';
import { useKeyboard } from './hooks/useKeyboard';
import { useCollab } from './hooks/useCollab';
import { applyPersistedMute } from './hooks/useSoundToggle';
import { useProjectId, useProjectName, useHasShareableContent } from './store/selectors';
import { startAutosave } from './persistence/autosave';
import { startCloudAutosave } from './persistence/cloudAutosave';
import { listProjects } from './persistence/db';
import { loadProjectWithAudio } from './audio/audioFile';
import { openCloudProject } from './persistence/cloudSync';
import { isVerified, rememberTokens } from './auth/session';
import { hasFirebaseConfig } from './auth/firebase';
import { onCloudChanged } from './auth/cloudSignal';
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
  // A bare base-URL visitor must sign in before they get an editor or can create a set; a
  // share-link recipient bypasses the gate entirely (their token is the session credential).
  // When Firebase isn't configured at all, there's no cloud to sign in to — fall through to the
  // offline, local-only editor rather than a dead-end gate.
  const [authed, setAuthed] = useState(() => !hasFirebaseConfig() || isVerified() || !!bootLink);
  useKeyboard();

  // Live collaboration for the current (cloud) project. Mounted unconditionally to keep hook
  // order stable; it stays inert for a non-cloud project (no tokens → no channel).
  const projectId = useProjectId();
  const projectName = useProjectName();
  const hasShareableContent = useHasShareableContent();
  const collab = useCollab(projectId);

  // Reflect the current project name in the browser tab title. The static <title> from the
  // root layout only ever shows the app name, so keep it in sync as the project loads/renames.
  // Falls back to the bare app name when the project is unnamed.
  useEffect(() => {
    document.title = projectName ? `${projectName} · Cue Timeline` : 'Cue Timeline';
  }, [projectName]);

  // A session is "active" once the user has signed in OR is here on a share link. The editor and
  // all its persistence/sharing machinery only run for an active session.
  const sessionActive = authed || !!bootLink;

  // Re-derive auth when cloud access changes (e.g. signing out via the TopBar drops the editor
  // back to the gate; signing in / publishing keeps it).
  useEffect(
    () => onCloudChanged(() => setAuthed(!hasFirebaseConfig() || isVerified() || !!bootLink)),
    [bootLink],
  );

  // Autosave for an active session (local IndexedDB + automatic cloud snapshots).
  useEffect(() => {
    if (!sessionActive) return;
    return startAutosave();
  }, [sessionActive]);
  useEffect(() => {
    if (!sessionActive) return;
    return startCloudAutosave();
  }, [sessionActive]);

  // Apply the persisted per-device mute preference once on boot.
  useEffect(() => applyPersistedMute(), []);

  // Keep the address bar as a live edit link for the current project, so copy-pasting the URL
  // loads THIS project on another computer — not the recipient's own most-recent one. For a
  // still-local set, a verified user auto-publishes it to the cloud first so the link works.
  // Re-runs when the project changes OR first gains shareable content (audio/blocks), so a set
  // built up within one session also gets published once there's something to share.
  useEffect(() => {
    if (!sessionActive) return;
    void ensureShareableUrl(projectId);
  }, [projectId, hasShareableContent, sessionActive]);

  // Boot — share link: a ?p=… link takes precedence and opens that cloud set directly, for
  // verified users and unauthenticated recipients alike. Runs once (bootLink never changes).
  useEffect(() => {
    const link = bootLink;
    if (!link) return;
    let cancelled = false;
    (async () => {
      // Persist any tokens from the link. The url-reflection effect re-normalises the address
      // bar to the canonical share link once the project loads.
      if (link.view) rememberTokens(link.id, { view: link.view });
      if (link.edit) rememberTokens(link.id, { edit: link.edit });
      try {
        const r = await openCloudProject(link.id);
        if (cancelled) return;
        if (!r.audioReady) setBanner('Opened set, but its audio could not be loaded.');
      } catch (err) {
        if (cancelled) return;
        setBanner(`Could not open the shared set: ${(err as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootLink]);

  // Boot — signed-in landing: with no share link, reopen the most recent local project once the
  // user is authed, else offer the start dialog. Re-runs when a fresh sign-in flips `authed`.
  useEffect(() => {
    if (!authed || bootLink) return;
    let cancelled = false;
    (async () => {
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
  }, [authed, bootLink]);

  if (!authed && !bootLink) {
    return <SignInGate onSignedIn={() => setAuthed(true)} />;
  }

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

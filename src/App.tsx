import { useEffect, useState } from 'react';
import './App.css';
import { TopBar } from './ui/TopBar';
import { Timeline } from './ui/Timeline';
import { Transport } from './ui/Transport';
import { StartDialog } from './ui/StartDialog';
import { useKeyboard } from './hooks/useKeyboard';
import { startAutosave } from './persistence/autosave';
import { listProjects } from './persistence/db';
import { loadProjectWithAudio } from './audio/audioFile';

export default function App() {
  const [startOpen, setStartOpen] = useState(false);
  useKeyboard();

  // Autosave for the whole session.
  useEffect(() => startAutosave(), []);

  // On boot: reopen the most recent project if any (spec §13.2), else keep the fresh
  // default project and offer the start dialog.
  useEffect(() => {
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
  }, []);

  return (
    <div className="app">
      <TopBar onOpenLibrary={() => setStartOpen(true)} />
      <Timeline />
      <Transport />
      <StartDialog open={startOpen} onClose={() => setStartOpen(false)} />
    </div>
  );
}

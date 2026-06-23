// Automatic cloud snapshotting for projects already backed by an editable cloud set.
//
// Distinct from the local IndexedDB autosave (autosave.ts): this pushes a NEW immutable
// cloud snapshot on a COARSE, idle debounce, so the snapshot history reads as a list of
// periodic checkpoints rather than one entry per keystroke. It deliberately does NOT itself
// create a cloud project from a local one — it only appends once an edit token exists. First
// publish happens elsewhere: explicitly via ProjectMenu "Save to cloud", or automatically for
// a verified user by the address-bar share-link reflection (see auth/shareUrl.ts).
//
// startCloudAutosave() returns an unsubscribe that cancels the timer, flushes a final
// pending save, and detaches the page-lifecycle listeners.

import { useStore } from '../store/store';
import { saveCurrentToCloud } from './cloudSync';
import { getProjectTokens } from '../auth/session';

const CLOUD_DEBOUNCE_MS = 10_000;

/** True when the current project is an online cloud set this device may edit. */
function canAutoCloudSave(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  const id = useStore.getState().core.id;
  return !!getProjectTokens(id).edit;
}

export function startCloudAutosave(): () => void {
  let prevCore = useStore.getState().core;
  let prevView = useStore.getState().view;
  let prevId = useStore.getState().core.id;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> = Promise.resolve();
  let stopped = false;
  let pending = false; // an edit happened that hasn't been pushed yet

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  /** Push the current project as a new snapshot, serialized against any in-flight save. */
  const flush = (): Promise<void> => {
    if (!canAutoCloudSave()) return saving;
    pending = false;
    useStore.getState().setCloudSave('saving');
    saving = saving
      .catch(() => undefined) // never let a prior failure break the chain
      .then(() => saveCurrentToCloud())
      .then(
        () => useStore.getState().setCloudSave('saved', { at: Date.now() }),
        // Capture the reason so the save indicator can surface it on click.
        (err) =>
          useStore
            .getState()
            .setCloudSave('error', { error: (err as Error)?.message ?? String(err) }),
      );
    return saving;
  };

  const schedule = (): void => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      if (!stopped) void flush();
    }, CLOUD_DEBOUNCE_MS);
  };

  const unsubscribe = useStore.subscribe((state) => {
    const idChanged = state.core.id !== prevId;
    const changed = state.core !== prevCore || state.view !== prevView;
    prevCore = state.core;
    prevView = state.view;
    prevId = state.core.id;
    // A project switch (open/new) is not an edit — discard any pending save for the
    // previous project so we never snapshot a freshly-loaded set the user didn't touch.
    if (idChanged) {
      clearTimer();
      pending = false;
      return;
    }
    if (!changed || !canAutoCloudSave()) return;
    pending = true;
    schedule();
  });

  // Push any pending edit immediately when the tab is hidden or unloaded.
  const flushNow = () => {
    clearTimer();
    if (pending) void flush();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flushNow();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flushNow);

  return () => {
    if (stopped) return;
    stopped = true;
    clearTimer();
    unsubscribe();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', flushNow);
    if (pending) void flush();
  };
}

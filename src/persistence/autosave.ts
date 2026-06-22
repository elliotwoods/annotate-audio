// Debounced autosave to IndexedDB (spec §13.2).
//
// Subscribes to the store and, whenever the canonical content (`core`) OR the persisted
// `view` slice changes by reference, schedules a debounced save of the full exported
// Project. Transient slices (playback / selection / laneWidth / peaks / detection) are
// ignored — they are never persisted, so changes to them must not trigger a write.
//
// startAutosave() returns an unsubscribe function that cancels any pending timer, performs
// one final flush save, and removes the subscription. Overlapping saves are guarded so a
// new save waits for the in-flight one before issuing.

import { useStore } from '../store/store';
import { saveProject } from './db';

const DEBOUNCE_MS = 1500;

export function startAutosave(): () => void {
  // Track the slices we care about by reference; seed from the current state so the first
  // notification only fires a save if something actually changed.
  let prevCore = useStore.getState().core;
  let prevView = useStore.getState().view;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> = Promise.resolve();
  let stopped = false;
  // Only persist on teardown if something actually changed since startup. Prevents
  // React StrictMode's mount→unmount→remount from flushing a phantom default project.
  let dirty = false;

  /** Persist the current exported Project, serializing against any in-flight save. */
  const flush = (): Promise<void> => {
    const project = useStore.getState().exportProject();
    saving = saving
      .catch(() => undefined) // never let a prior failure break the chain
      .then(() => saveProject(project));
    return saving;
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (stopped) return;
      void flush();
    }, DEBOUNCE_MS);
  };

  const unsubscribe = useStore.subscribe((state) => {
    const coreChanged = state.core !== prevCore;
    const viewChanged = state.view !== prevView;
    if (!coreChanged && !viewChanged) return;
    prevCore = state.core;
    prevView = state.view;
    dirty = true;
    schedule();
  });

  return () => {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    unsubscribe();
    // One final flush so the latest edits aren't lost — but only if there were edits.
    if (dirty) void flush();
  };
}

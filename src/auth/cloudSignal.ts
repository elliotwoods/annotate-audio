// A tiny "cloud access changed" signal.
//
// Publishing a local set to the cloud (or signing in) grants tokens / verified status WITHOUT
// changing the project id, so components that memoise cloud access keyed on [projectId] alone
// never recompute. Fire emitCloudChanged() after any such mutation; subscribers (e.g. the
// TopBar share/view-only cluster) re-read session state in response.
//
// Mirrors the refreshCollab() listener-set pattern in hooks/useCollab.ts.

const listeners = new Set<() => void>();

/** Notify every subscriber that cloud access for the current project may have changed. */
export function emitCloudChanged(): void {
  for (const l of listeners) l();
}

/** Subscribe to cloud-access changes. Returns an unsubscribe. */
export function onCloudChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

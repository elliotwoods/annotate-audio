// Keeps the browser address bar in sync with the current cloud session so that simply
// copy-pasting the page URL shares it — with whatever access the current user holds.
//
// An editor's URL carries the EDIT token (?p=<id>&e=<token>), so pasting it gives a
// collaborator edit privileges. A view-only user's URL carries the view token instead, and a
// local (non-cloud) project clears back to the bare app URL. The token therefore lives in the
// address bar and browser history — the same trade-off the Share dialog already warns about.
//
// ensureShareableUrl() goes one step further: a bare app URL only loads the recipient's OWN
// most-recent project, not this one. So for a verified user sitting on a still-local project
// worth sharing, it auto-publishes the set to the cloud FIRST (uploading its audio), turning
// the address bar into a live edit link that loads THIS project on any other computer.

import { getProjectTokens, isVerified } from './session';
import { saveCurrentToCloud } from '../persistence/cloudSync';
import { refreshCollab } from '../hooks/useCollab';
import { emitCloudChanged } from './cloudSignal';
import { useStore } from '../store/store';

function appBase(): string {
  return `${window.location.origin}/`;
}

/** The shareable URL for a project, using the strongest token the current user holds. */
export function buildShareUrl(projectId: string): string {
  const base = appBase();
  const t = getProjectTokens(projectId);
  const p = encodeURIComponent(projectId);
  if (t.edit) return `${base}?p=${p}&e=${encodeURIComponent(t.edit)}`;
  if (t.view) return `${base}?p=${p}&v=${encodeURIComponent(t.view)}`;
  return `${base}?p=${p}`;
}

/**
 * Reflect the current project into the address bar. For a cloud project the URL becomes a
 * working share link (edit link when the user can edit); for a non-cloud project the query
 * is cleared back to the bare app URL. Uses replaceState so it doesn't add history entries.
 */
export function reflectShareUrl(projectId: string): void {
  const t = getProjectTokens(projectId);
  const isCloud = !!(t.view || t.edit);
  const next = isCloud ? buildShareUrl(projectId) : appBase();
  if (window.location.href !== next) {
    window.history.replaceState(null, '', next);
  }
}

/** Project ids whose auto-publish is in flight, so a re-entrant reflect doesn't double-create
 *  (e.g. React StrictMode invoking the effect twice). */
const publishing = new Set<string>();

/** A still-local project is worth auto-publishing once it has real content to share. An
 *  untouched default / freshly-"New"ed project (no audio, no blocks) is not — publishing it
 *  would just litter the cloud with empty sets on every boot. */
function worthPublishing(projectId: string): boolean {
  const { core } = useStore.getState();
  if (core.id !== projectId) return false; // store already moved to another project
  return !!core.audio || core.blocks.length > 0;
}

/**
 * Make the address bar a URL that loads the CURRENT project on another computer — an edit link
 * when possible — rather than a bare URL that opens the recipient's own most-recent project.
 *
 * Already a cloud set → just reflectShareUrl (edit link when the user can edit). Still local,
 * but the user is verified (so can create cloud sets) and it has real content → auto-publish to
 * the cloud first, then reflect the resulting edit link. Otherwise (not verified, nothing worth
 * sharing yet) → reflectShareUrl, which clears to the bare app URL.
 *
 * Note: a verified user holding a LOCAL copy of an already-published set (no stored token) hits
 * saveCurrentToCloud's 409→snapshot path, which can't recover the token, so its URL stays bare —
 * a narrow case (requires importing an exported copy) and no worse than before.
 */
export async function ensureShareableUrl(projectId: string): Promise<void> {
  if (publishing.has(projectId)) return; // an in-flight publish will reflect when it finishes

  const t = getProjectTokens(projectId);
  const isCloud = !!(t.view || t.edit);
  if (isCloud || !isVerified() || !worthPublishing(projectId)) {
    reflectShareUrl(projectId);
    return;
  }

  publishing.add(projectId);
  useStore.getState().setCloudSave('saving');
  try {
    await saveCurrentToCloud();
    useStore.getState().setCloudSave('saved', { at: Date.now() });
    // Publishing grants edit access without changing the id, so views memoised on [projectId]
    // wouldn't otherwise recompute: rejoin live and tell the TopBar to surface Share/Sync.
    refreshCollab();
    emitCloudChanged();
  } catch (err) {
    useStore.getState().setCloudSave('error', { error: (err as Error)?.message ?? String(err) });
    // Stay local; the address bar simply isn't a remote link yet (e.g. offline). The next
    // project switch / reflect retries.
  } finally {
    publishing.delete(projectId);
    // Only touch the address bar if we're still on this project — the user may have switched
    // away mid-publish, and reflecting the stale id would stomp the newer URL.
    if (useStore.getState().core.id === projectId) reflectShareUrl(projectId);
  }
}

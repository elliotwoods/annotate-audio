// Share dialog: surfaces the view-only and edit private links for the current cloud set.
// Links carry the project id + the relevant token; anyone with a link gets that capability.

import { useEffect, useState } from 'react';
import './StartDialog.css';
import { getProjectTokens } from '../auth/session';

function shareUrl(id: string, kind: 'v' | 'e', token: string): string {
  const base = `${window.location.origin}/`;
  return `${base}?p=${encodeURIComponent(id)}&${kind}=${encodeURIComponent(token)}`;
}

export function ShareDialog({
  open,
  projectId,
  onClose,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open && e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const tokens = getProjectTokens(projectId);
  const copy = async (label: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(label);
      setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog" onPointerDown={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="dialog-head">
          <h2>Share this set</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {!tokens.view && !tokens.edit ? (
          <p className="muted">
            This set isn’t in the cloud yet. Add audio or a cue and it saves to the cloud
            automatically — your shareable links will appear here.
          </p>
        ) : (
          <>
            {tokens.edit && (
              <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
                Tip: this page’s address bar <strong>is</strong> your edit link — you can just copy
                the URL straight from the browser to invite a collaborator.
              </p>
            )}
            {tokens.edit && (
              <LinkRow
                title="Edit link (invite)"
                hint="Recipients open read-only, then sign in to edit — they become a saved editor."
                url={shareUrl(projectId, 'e', tokens.edit)}
                copied={copied === 'edit'}
                onCopy={(u) => void copy('edit', u)}
              />
            )}
            {tokens.view && (
              <LinkRow
                title="View-only link"
                hint="Recipients can open and play, but not save."
                url={shareUrl(projectId, 'v', tokens.view)}
                copied={copied === 'view'}
                onCopy={(u) => void copy('view', u)}
              />
            )}
            <p className="muted" style={{ fontSize: 12 }}>
              Anyone with a link has that access. Treat these as private — they may be stored in
              browser history.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function LinkRow({
  title,
  hint,
  url,
  copied,
  onCopy,
}: {
  title: string;
  hint: string;
  url: string;
  copied: boolean;
  onCopy: (url: string) => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>
      <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
        {hint}
      </div>
      <div className="dialog-actions" style={{ marginTop: 0 }}>
        <input readOnly value={url} onFocus={(e) => e.target.select()} style={{ flex: 1, minWidth: 0 }} />
        <button className="primary" onClick={() => onCopy(url)}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

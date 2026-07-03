// Shown to a signed-in user who isn't on the invite allowlist yet. They can still open shared
// sets via a link (that bypasses this), but can't create/own sets until an admin approves them.

import { useState } from 'react';
import './StartDialog.css';
import { signOutUser } from '../auth/session';
import { clearMe } from '../auth/me';

export function AccessPending({ email }: { email: string | null }) {
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try {
      await signOutUser();
      clearMe();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" style={{ background: 'var(--bg-0, #0b0b0d)' }}>
      <div className="dialog" onPointerDown={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="dialog-head">
          <h2>Access pending</h2>
        </div>
        <p className="muted" style={{ margin: '12px 16px 0' }}>
          You’re signed in{email ? ` as ${email}` : ''}, but this account isn’t approved yet.
          An administrator needs to grant you access before you can create or edit your own sets.
          You can still open a set someone shared with you using its link.
        </p>
        <div className="dialog-actions">
          <button disabled={busy} onClick={() => void signOut()} style={{ flex: 1 }}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Full-screen sign-in gate. Shown instead of the editor when the visitor is neither signed in
// nor arriving on a share link: nobody reaches the editor (or creates a project) without first
// signing in. A share-link recipient bypasses this entirely — their token IS the session
// credential — so the gate only ever fronts a bare, unauthenticated base-URL visit.

import { useState } from 'react';
import './StartDialog.css';
import { signInWithGoogle } from '../auth/session';

export function SignInGate({ onSignedIn }: { onSignedIn: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      onSignedIn();
    } catch (err) {
      setError(`Could not sign in: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" style={{ background: 'var(--bg-0, #0b0b0d)' }}>
      <div className="dialog" onPointerDown={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="dialog-head">
          <h2>Sign in</h2>
        </div>

        <p className="muted" style={{ margin: '12px 16px 0' }}>
          Sign in to create and edit your own sets. Your sets sync to your account, so they’re
          there on any device. To open a specific set without signing in, use its share link.
        </p>

        <div className="dialog-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void submit()}
            style={{ flex: 1 }}
          >
            {busy ? 'Signing in…' : 'Sign in with Google'}
          </button>
        </div>

        {error && <div className="dialog-notice">{error}</div>}
      </div>
    </div>
  );
}

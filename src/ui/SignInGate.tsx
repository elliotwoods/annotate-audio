// Full-screen sign-in gate. Shown instead of the editor when the visitor is neither verified
// nor arriving on a share link: nobody reaches the editor (or creates a project) without first
// entering the access key. A share-link recipient bypasses this entirely — their token IS the
// session credential — so the gate only ever fronts a bare, unauthenticated base-URL visit.
//
// Mirrors LoginDialog's verify flow, but as a non-dismissable blocking screen (no close button,
// no Escape, no backdrop dismissal).

import { useEffect, useRef, useState } from 'react';
import './StartDialog.css';
import { verifyKey } from '../persistence/cloud';
import { setAdminKey } from '../auth/session';

export function SignInGate({ onSignedIn }: { onSignedIn: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const submit = async () => {
    const k = key.trim();
    if (!k) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await verifyKey(k);
      if (!ok) {
        setError('That key was not accepted.');
        return;
      }
      setAdminKey(k);
      onSignedIn();
    } catch (err) {
      setError(`Could not verify: ${(err as Error).message}`);
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
          Enter your access key to create and edit sets. The key is stored on this device so you
          stay signed in. To open a specific set without signing in, use its share link.
        </p>

        <div className="dialog-actions">
          <input
            ref={inputRef}
            type="password"
            value={key}
            placeholder="Access key"
            autoComplete="off"
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button className="primary" disabled={busy || !key.trim()} onClick={() => void submit()}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </div>

        {error && <div className="dialog-notice">{error}</div>}
      </div>
    </div>
  );
}

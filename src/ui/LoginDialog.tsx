// Verified-user login: paste the admin key, verify it against the server, and keep it in
// localStorage so the user stays logged in indefinitely (spec: cloud auth).

import { useEffect, useRef, useState } from 'react';
import './StartDialog.css';
import { verifyKey } from '../persistence/cloud';
import { setAdminKey, clearAdminKey, getAdminKey } from '../auth/session';

export function LoginDialog({
  open,
  onClose,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a successful login or logout so the parent can refresh cloud UI. */
  onChange: () => void;
}) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const verified = !!getAdminKey();

  useEffect(() => {
    if (open) {
      setKey('');
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open && e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

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
      onChange();
      onClose();
    } catch (err) {
      setError(`Could not verify: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const logout = () => {
    clearAdminKey();
    onChange();
    onClose();
  };

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog" onPointerDown={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="dialog-head">
          <h2>Verified access</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {verified ? (
          <>
            <p className="muted">
              You are signed in as a verified user and can create new cloud projects.
            </p>
            <div className="dialog-actions">
              <button onClick={logout}>Sign out</button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              Enter your access key to create and manage cloud projects. The key is stored on
              this device so you stay signed in.
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
          </>
        )}

        {error && <div className="dialog-notice">{error}</div>}
      </div>
    </div>
  );
}

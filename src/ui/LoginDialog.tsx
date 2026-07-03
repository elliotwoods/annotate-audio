// Sign-in dialog: authenticate with Firebase (Google) so you can create and own cloud sets.
// Firebase persists the session across reloads, so you stay signed in.

import { useEffect, useState } from 'react';
import './StartDialog.css';
import { signInWithGoogle, signOutUser, currentUser, onAuthChange } from '../auth/session';
import { getMe, subscribeMe, clearMe } from '../auth/me';

export function LoginDialog({
  open,
  onClose,
  onChange,
  onOpenAdmin,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a successful sign-in or sign-out so the parent can refresh cloud UI. */
  onChange: () => void;
  /** Open the admin panel (only offered when the signed-in user is an admin). */
  onOpenAdmin?: () => void;
}) {
  const [user, setUser] = useState(() => currentUser());
  const [me, setMe] = useState(getMe);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onAuthChange(setUser), []);
  useEffect(() => subscribeMe(() => setMe(getMe())), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open && e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      onChange();
      onClose();
    } catch (err) {
      setError(`Could not sign in: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError(null);
    try {
      await signOutUser();
      clearMe();
      onChange();
      onClose();
    } catch (err) {
      setError(`Could not sign out: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div className="dialog" onPointerDown={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div className="dialog-head">
          <h2>Account</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {user ? (
          <>
            <p className="muted">
              Signed in as <strong>{user.email ?? user.displayName ?? user.uid}</strong>. You can
              create cloud sets and they’ll appear in your library on any device.
            </p>
            {me.admin && (
              <p className="muted" style={{ marginTop: 4 }}>
                You have <strong>admin</strong> access.
              </p>
            )}
            <div className="dialog-actions">
              {me.admin && onOpenAdmin && (
                <button className="primary" disabled={busy} onClick={onOpenAdmin}>
                  Admin panel
                </button>
              )}
              <button disabled={busy} onClick={() => void signOut()}>
                {busy ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">
              Sign in to create and manage your own cloud sets. To open a specific set without an
              account, use its share link.
            </p>
            <div className="dialog-actions">
              <button className="primary" disabled={busy} onClick={() => void signIn()}>
                {busy ? 'Signing in…' : 'Sign in with Google'}
              </button>
            </div>
          </>
        )}

        {error && <div className="dialog-notice">{error}</div>}
      </div>
    </div>
  );
}

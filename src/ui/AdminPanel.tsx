// Admin panel: moderate users. Lists Firebase Auth users with created / last-login, approval
// and admin status, and set-ownership counts; lets an admin approve an email (invite), toggle
// disabled, grant/revoke admin, and delete a user. Admin-gated at both the API and the entry
// point (only rendered when the signed-in user is an admin).

import { useCallback, useEffect, useState } from 'react';
import './StartDialog.css';
import './AdminPanel.css';
import {
  adminListUsers,
  adminApproveEmail,
  adminUpdateUser,
  adminDeleteUser,
  type AdminUser,
} from '../auth/me';

export function AdminPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [pending, setPending] = useState<{ email: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminListUsers();
      setUsers(r.users);
      setPending(r.pendingInvites ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => open && e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const approve = () => {
    const email = newEmail.trim();
    if (!email) return;
    setNewEmail('');
    void run(() => adminApproveEmail(email));
  };

  return (
    <div className="dialog-backdrop" onPointerDown={onClose}>
      <div
        className="dialog admin-panel"
        onPointerDown={(e) => e.stopPropagation()}
        style={{ maxWidth: 760 }}
      >
        <div className="dialog-head">
          <h2>Admin · Users</h2>
          <button className="ghost icon" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="admin-invite">
          <input
            type="email"
            placeholder="email@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && approve()}
          />
          <button className="primary" onClick={approve} disabled={!newEmail.trim()}>
            Approve email
          </button>
          <button className="ghost" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {error && <div className="dialog-notice">{error}</div>}

        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Sets</th>
                <th>Created</th>
                <th>Last sign-in</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.uid} className={u.disabled ? 'is-disabled' : ''}>
                  <td>
                    <div className="admin-user">
                      <strong>{u.displayName ?? u.email ?? u.uid}</strong>
                      {u.email && <span className="admin-user__email">{u.email}</span>}
                    </div>
                  </td>
                  <td>
                    {u.admin && <span className="admin-badge admin-badge--admin">Admin</span>}
                    {u.approved ? (
                      <span className="admin-badge admin-badge--ok">Approved</span>
                    ) : (
                      <span className="admin-badge">Pending</span>
                    )}
                    {u.disabled && <span className="admin-badge admin-badge--off">Disabled</span>}
                  </td>
                  <td>{u.ownedCount}</td>
                  <td>{fmt(u.createdAt)}</td>
                  <td>{fmt(u.lastSignInAt)}</td>
                  <td className="admin-actions">
                    <button onClick={() => void run(() => adminUpdateUser(u.uid, { disabled: !u.disabled }))}>
                      {u.disabled ? 'Enable' : 'Disable'}
                    </button>
                    <button onClick={() => void run(() => adminUpdateUser(u.uid, { admin: !u.admin }))}>
                      {u.admin ? 'Revoke admin' : 'Make admin'}
                    </button>
                    <button
                      className="danger"
                      onClick={() =>
                        confirm(`Delete ${u.email ?? u.uid}? This cannot be undone.`) &&
                        void run(() => adminDeleteUser(u.uid))
                      }
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {pending.map((p) => (
                <tr key={`pending:${p.email}`} className="is-pending">
                  <td>
                    <div className="admin-user">
                      <strong>{p.email}</strong>
                      <span className="admin-user__email">not signed in yet</span>
                    </div>
                  </td>
                  <td>
                    <span className="admin-badge admin-badge--ok">Approved</span>
                    <span className="admin-badge">Invited</span>
                  </td>
                  <td>—</td>
                  <td>—</td>
                  <td>—</td>
                  <td className="admin-actions">—</td>
                </tr>
              ))}
              {users.length === 0 && pending.length === 0 && !loading && (
                <tr>
                  <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 20 }}>
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
}

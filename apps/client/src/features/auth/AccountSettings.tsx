import React, { useState, useEffect } from 'react';
import {
  authLogin,
  authRegister,
  authLogout,
  getAccount,
  getSessions,
  deleteSession,
  patchPassword,
  deleteAccount,
  type AccountInfo,
  type SessionInfo,
} from '../sync/api';
import {
  getAuthUser,
  getServerUrl,
  setServerUrl,
  clearAuth,
  DEFAULT_SERVER_URL,
  type StoredUser,
} from './storage';
import { db, dirty, SYNC_TABLES, type Device } from '../../db';
import { syncEngine, useSyncStore } from '../sync/engine';
import { Button } from '../../design/components/Button';
import { Dialog } from '../../design/components/Dialog';
import { fmtBytes, fmtDate } from '../../lib/format';
import {
  User,
  HardDrive,
  Laptop,
  LogOut,
  Trash2,
  Server,
  ShieldAlert,
  Loader2,
} from 'lucide-react';

export interface AccountSettingsProps {
  onAuthChange?: () => void;
}

export const AccountSettings: React.FC<AccountSettingsProps> = ({ onAuthChange }) => {
  const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
  const [serverUrlVal, setServerUrlVal] = useState(DEFAULT_SERVER_URL);
  const [isEditingServer, setIsEditingServer] = useState(false);

  // Auth form states
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Account details states
  const [accountInfo, setAccountInfo] = useState<AccountInfo | null>(null);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);

  // Password change states
  const [currPass, setCurrPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [passMsg, setPassMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [passLoading, setPassLoading] = useState(false);

  // Dialogs
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [mergePromptUser, setMergePromptUser] = useState<string | null>(null);

  const runSync = useSyncStore((s) => s.runSync);

  const loadUserState = async () => {
    const u = await getAuthUser();
    setCurrentUser(u);
    const sUrl = await getServerUrl();
    setServerUrlVal(sUrl);

    if (u) {
      try {
        const [acc, sess, devs] = await Promise.all([
          getAccount().catch(() => null),
          getSessions().catch(() => []),
          db.devices.toArray().catch(() => []),
        ]);
        setAccountInfo(acc);
        setSessions(sess);
        setDevices(devs);
      } catch {
        // Non-fatal
      }
    }
  };

  useEffect(() => {
    void loadUserState();
  }, []);

  const handleSaveServerUrl = async () => {
    await setServerUrl(serverUrlVal);
    setIsEditingServer(false);
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setAuthLoading(true);
    setAuthError(null);

    try {
      const prevUserRow = await db.kv.get('last_logged_in_email');
      const prevEmail = typeof prevUserRow?.value === 'string' ? prevUserRow.value : null;

      let authResult;
      if (authMode === 'register') {
        authResult = await authRegister(email.trim(), password);
      } else {
        authResult = await authLogin(email.trim(), password);
      }

      const newEmail = authResult.user.email;
      await db.kv.put({ key: 'last_logged_in_email', value: newEmail });

      // Check if signing in into a different account than last time
      if (prevEmail && prevEmail !== newEmail) {
        setMergePromptUser(newEmail);
      } else {
        // Mark everything dirty on first sync or existing data
        await dirtyAllSyncedRows();
        void runSync();
        void syncEngine.connectSSE();
      }

      await loadUserState();
      onAuthChange?.();
    } catch (err: unknown) {
      setAuthError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const dirtyAllSyncedRows = async () => {
    for (const table of SYNC_TABLES) {
      const rows = await db.table(table).toArray();
      await db.transaction('rw', db.table(table), async () => {
        for (const r of rows) {
          await db.table(table).update(r.id, dirty());
        }
      });
    }
  };

  const wipeLocalSyncedData = async () => {
    for (const table of SYNC_TABLES) {
      await db.table(table).clear();
    }
    await db.files.clear();
    await db.covers.clear();
    await db.kv.delete('sync_cursor');
    await db.kv.delete('uploaded_files');
  };

  const handleMergeChoice = async (choice: 'merge' | 'fresh') => {
    if (choice === 'merge') {
      await dirtyAllSyncedRows();
    } else {
      await wipeLocalSyncedData();
    }
    setMergePromptUser(null);
    void runSync();
    void syncEngine.connectSSE();
  };

  const handleRevokeSession = async (tokenHash: string) => {
    try {
      await deleteSession(tokenHash);
      setSessions((prev) => prev.filter((s) => s.token_hash !== tokenHash));
    } catch {
      // Non-fatal
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currPass || !newPass) return;
    setPassLoading(true);
    setPassMsg(null);
    try {
      await patchPassword(currPass, newPass);
      setPassMsg({ text: 'Password updated successfully!' });
      setCurrPass('');
      setNewPass('');
    } catch (err: unknown) {
      setPassMsg({
        text: err instanceof Error ? err.message : 'Failed to update password',
        error: true,
      });
    } finally {
      setPassLoading(false);
    }
  };

  const handleSignOut = async (removeLocal: boolean) => {
    await authLogout();
    syncEngine.disconnectSSE();
    if (removeLocal) {
      await wipeLocalSyncedData();
    }
    await clearAuth();
    setSignOutOpen(false);
    await loadUserState();
    onAuthChange?.();
  };

  const handleDeleteAccount = async () => {
    try {
      await deleteAccount();
      syncEngine.disconnectSSE();
      await wipeLocalSyncedData();
      await clearAuth();
      setDeleteAccountOpen(false);
      await loadUserState();
      onAuthChange?.();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to delete account');
    }
  };

  return (
    <div className="flex flex-col gap-6 py-1">
      {/* Server URL setting */}
      <section className="flex flex-col gap-2 p-3 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-4 h-4 text-[var(--accent)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-2)]">
              Sync Server
            </span>
          </div>
          {!isEditingServer && (
            <button
              type="button"
              onClick={() => setIsEditingServer(true)}
              className="text-xs font-medium text-[var(--accent)] hover:underline cursor-pointer"
            >
              Change
            </button>
          )}
        </div>

        {isEditingServer ? (
          <div className="flex items-center gap-2 mt-1">
            <input
              type="url"
              value={serverUrlVal}
              onChange={(e) => setServerUrlVal(e.target.value)}
              className="flex-1 px-3 py-1.5 text-xs rounded-[var(--r-sm)] bg-[var(--bg-base)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
              placeholder={DEFAULT_SERVER_URL}
            />
            <Button size="sm" variant="accent" onClick={handleSaveServerUrl}>
              Save
            </Button>
            <Button size="sm" variant="subtle" onClick={() => setIsEditingServer(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <span className="text-xs font-mono text-[var(--text-2)] truncate">{serverUrlVal}</span>
        )}
      </section>

      {/* When NOT signed in: Login / Register Form */}
      {!currentUser ? (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--text-1)]">
              {authMode === 'login' ? 'Sign in to Folio' : 'Create an Account'}
            </h3>
            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === 'login' ? 'register' : 'login');
                setAuthError(null);
              }}
              className="text-xs text-[var(--accent)] hover:underline cursor-pointer"
            >
              {authMode === 'login' ? 'Need an account? Register' : 'Already have an account? Sign in'}
            </button>
          </div>

          <form onSubmit={handleAuthSubmit} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="auth-email-input" className="text-xs font-medium text-[var(--text-2)]">Email address</label>
              <input
                id="auth-email-input"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="reader@example.com"
                className="px-3 py-2 text-sm rounded-[var(--r-md)] bg-[var(--layer-1)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="auth-password-input" className="text-xs font-medium text-[var(--text-2)]">Password</label>
              <input
                id="auth-password-input"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="px-3 py-2 text-sm rounded-[var(--r-md)] bg-[var(--layer-1)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
              />
            </div>

            {authError && (
              <div className="p-2.5 rounded-[var(--r-sm)] bg-[color-mix(in_oklab,var(--danger)_15%,transparent)] text-xs text-[var(--danger)]">
                {authError}
              </div>
            )}

            <Button
              type="submit"
              variant="accent"
              disabled={authLoading}
              className="mt-2 w-full justify-center"
            >
              {authLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-1.5" />
                  {authMode === 'login' ? 'Signing in…' : 'Creating account…'}
                </>
              ) : (
                authMode === 'login' ? 'Sign in' : 'Create account'
              )}
            </Button>
          </form>
        </section>
      ) : (
        /* When SIGNED IN: Account Management */
        <section className="flex flex-col gap-5">
          {/* User overview */}
          <div className="flex items-center justify-between p-3 rounded-[var(--r-md)] bg-[var(--layer-2)] border border-[var(--stroke)]">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center font-bold">
                <User className="w-5 h-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-[var(--text-1)]">{currentUser.email}</div>
                <div className="text-xs text-[var(--text-2)] flex items-center gap-1.5 mt-0.5">
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>
                    Storage used: {accountInfo ? fmtBytes(accountInfo.storageUsed) : 'Calculating…'}
                  </span>
                </div>
              </div>
            </div>

            <Button
              size="sm"
              variant="subtle"
              onClick={() => setSignOutOpen(true)}
              icon={<LogOut className="w-4 h-4" />}
            >
              Sign out
            </Button>
          </div>

          {/* Connected Devices */}
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)]">
              Registered Devices ({devices.length})
            </div>
            <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
              {devices.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between p-2 rounded-[var(--r-sm)] bg-[var(--layer-1)] border border-[var(--stroke)] text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <Laptop className="w-4 h-4 text-[var(--text-2)] shrink-0" />
                    <span className="font-medium text-[var(--text-1)] truncate">{d.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--layer-3)] text-[var(--text-3)] uppercase">
                      {d.platform}
                    </span>
                  </div>
                  {d.last_seen_at && (
                    <span className="text-[11px] text-[var(--text-3)] shrink-0">
                      {fmtDate(d.last_seen_at)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Active Sessions */}
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)]">
              Active Sessions ({sessions.length})
            </div>
            <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto pr-1">
              {sessions.map((s) => (
                <div
                  key={s.token_hash}
                  className="flex items-center justify-between p-2 rounded-[var(--r-sm)] bg-[var(--layer-1)] border border-[var(--stroke)] text-xs"
                >
                  <div>
                    <span className="font-medium text-[var(--text-1)]">
                      {s.device_name || 'Browser Session'}
                    </span>
                    <span className="text-[11px] text-[var(--text-3)] ml-2">
                      Created {new Date(s.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRevokeSession(s.token_hash)}
                    className="text-[11px] text-[var(--danger)] hover:underline cursor-pointer"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Change password */}
          <div className="flex flex-col gap-2 pt-2 border-t border-[var(--stroke)]">
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-3)]">
              Change Password
            </div>
            <form onSubmit={handleChangePassword} className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="password"
                  required
                  placeholder="Current password"
                  value={currPass}
                  onChange={(e) => setCurrPass(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-[var(--r-sm)] bg-[var(--layer-1)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
                />
                <input
                  type="password"
                  required
                  minLength={8}
                  placeholder="New password"
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  className="px-3 py-1.5 text-xs rounded-[var(--r-sm)] bg-[var(--layer-1)] border border-[var(--stroke)] text-[var(--text-1)] outline-none focus:border-[var(--accent)]"
                />
              </div>

              {passMsg && (
                <div
                  className={`p-2 rounded-[var(--r-sm)] text-xs ${
                    passMsg.error
                      ? 'bg-[color-mix(in_oklab,var(--danger)_15%,transparent)] text-[var(--danger)]'
                      : 'bg-[color-mix(in_oklab,var(--success)_15%,transparent)] text-[var(--success)]'
                  }`}
                >
                  {passMsg.text}
                </div>
              )}

              <Button
                type="submit"
                size="sm"
                variant="standard"
                disabled={passLoading || !currPass || !newPass}
                className="self-start"
              >
                {passLoading ? 'Updating…' : 'Update password'}
              </Button>
            </form>
          </div>

          {/* Danger zone: Delete account */}
          <div className="flex items-center justify-between pt-4 border-t border-[var(--stroke)]">
            <div>
              <div className="text-xs font-semibold text-[var(--danger)]">Delete Account</div>
              <div className="text-[11px] text-[var(--text-3)]">Permanently erase your account and server storage</div>
            </div>
            <Button
              size="sm"
              variant="subtle"
              className="text-[var(--danger)] hover:bg-[color-mix(in_oklab,var(--danger)_15%,transparent)]"
              onClick={() => setDeleteAccountOpen(true)}
              icon={<Trash2 className="w-4 h-4" />}
            >
              Delete account
            </Button>
          </div>
        </section>
      )}

      {/* Sign Out Confirmation Dialog */}
      <Dialog
        open={signOutOpen}
        onOpenChange={setSignOutOpen}
        title="Sign Out"
        description="Choose how you'd like to sign out from this device."
      >
        <div className="flex flex-col gap-4 py-3">
          <p className="text-xs text-[var(--text-2)] leading-relaxed">
            Would you like to keep downloaded books and your local reading history on this device, or completely clear everything?
          </p>
          <div className="flex flex-col gap-2">
            <Button
              variant="standard"
              onClick={() => handleSignOut(false)}
              className="w-full justify-center"
            >
              Keep books on this device
            </Button>
            <Button
              variant="accent"
              onClick={() => handleSignOut(true)}
              className="w-full justify-center bg-[var(--danger)] hover:opacity-90"
            >
              Remove everything
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Delete Account Confirmation Dialog */}
      <Dialog
        open={deleteAccountOpen}
        onOpenChange={setDeleteAccountOpen}
        title="Delete Account Permanently"
        description="This action cannot be undone."
      >
        <div className="flex flex-col gap-4 py-3">
          <div className="p-3 rounded-[var(--r-md)] bg-[color-mix(in_oklab,var(--danger)_15%,transparent)] border border-[color-mix(in_oklab,var(--danger)_30%,transparent)] flex items-start gap-2.5">
            <ShieldAlert className="w-5 h-5 text-[var(--danger)] shrink-0 mt-0.5" />
            <p className="text-xs text-[var(--text-1)] leading-relaxed">
              Are you sure? This will permanently delete your account, your synced library, reading progress, and all uploaded files from the server.
            </p>
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <Button variant="subtle" onClick={() => setDeleteAccountOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="accent"
              onClick={handleDeleteAccount}
              className="bg-[var(--danger)] hover:opacity-90"
            >
              Yes, delete account
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Merge Prompt Dialog */}
      <Dialog
        open={!!mergePromptUser}
        onOpenChange={(open) => !open && setMergePromptUser(null)}
        title="Merge Account Data?"
        description={`Signing into ${mergePromptUser}`}
      >
        <div className="flex flex-col gap-4 py-3">
          <p className="text-xs text-[var(--text-2)] leading-relaxed">
            This device has existing library data from a different account. Would you like to merge this device's library into <strong>{mergePromptUser}</strong>, or start fresh?
          </p>
          <div className="flex flex-col gap-2">
            <Button
              variant="accent"
              onClick={() => handleMergeChoice('merge')}
              className="w-full justify-center"
            >
              Merge into {mergePromptUser}
            </Button>
            <Button
              variant="standard"
              onClick={() => handleMergeChoice('fresh')}
              className="w-full justify-center"
            >
              Start fresh (wipe local data)
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
};

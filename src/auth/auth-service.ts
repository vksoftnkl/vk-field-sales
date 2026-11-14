import { count, eq } from 'drizzle-orm';

import type { DeviceStatus } from '@/api/types';
import { db } from '@/db/client';
import { getMeta, setMeta } from '@/db/meta';
import { users, type User } from '@/db/schema';
import { store } from '@/store';
import { deviceStatusChanged, signedIn, signedOut } from '@/store/sessionSlice';
import { countByStatus } from '@/sync/outbox';

import { keystore, type StoredSession } from './keystore';
import { verifyPassword } from './password';

/**
 * Sign-in happens entirely on the phone, against the users pulled from VK Nex during Sync.
 * No server is needed to sign in — only to sync.
 */

export type LoginErrorCode = 'NO_USERS' | 'BAD_CREDENTIALS' | 'DEVICE_BLOCKED';

export class LoginError extends Error {
  constructor(public readonly code: LoginErrorCode) {
    super(code);
    this.name = 'LoginError';
  }
}

function deviceStatus(): DeviceStatus | null {
  return getMeta('deviceStatus') as DeviceStatus | null;
}

const isBlocked = (s: DeviceStatus | null) => s === 'BLOCKED' || s === 'WIPE';

function activeUser(id: string): User | undefined {
  const u = db.select().from(users).where(eq(users.id, id)).get();
  return u?.isActive ? u : undefined;
}

/** True once at least one salesman has been downloaded (i.e. after the first Sync). */
export function hasUsers(): boolean {
  return (db.select({ n: count() }).from(users).where(eq(users.isActive, true)).get()?.n ?? 0) > 0;
}

/** Re-read names from the latest sync; drop the second salesman if they were disabled. */
function refreshed(session: StoredSession, primary: User): StoredSession {
  const second = session.secondUserId ? activeUser(session.secondUserId) : undefined;
  return {
    ...session,
    displayName: primary.displayName,
    secondUserId: second?.id ?? null,
    secondDisplayName: second?.displayName ?? null,
  };
}

/** Restore a saved session on app start. Offline; drops it if the user was disabled at the last sync. */
export async function restoreSession(): Promise<void> {
  void keystore.removeLegacyTokens().catch(() => {});
  const status = deviceStatus();
  store.dispatch(deviceStatusChanged(status));

  const session = await keystore.getSession();
  const user = session ? activeUser(session.userId) : undefined;
  if (session && user && !isBlocked(status)) {
    store.dispatch(signedIn(refreshed(session, user)));
  } else {
    if (session) await keystore.clearSession();
    store.dispatch(signedOut());
  }
}

/**
 * The salesman picks their name from the synced list and types their VK Nex password.
 * As in the old Qt app, an optional second salesman can be added (multi-user mode);
 * only the first salesman's password is checked.
 */
export async function login(userId: string, password: string, secondUserId?: string | null): Promise<void> {
  if (isBlocked(deviceStatus())) throw new LoginError('DEVICE_BLOCKED');
  if (!hasUsers()) throw new LoginError('NO_USERS');

  const user = activeUser(userId);
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw new LoginError('BAD_CREDENTIALS');

  const second = secondUserId && secondUserId !== user.id ? activeUser(secondUserId) : undefined;
  const session: StoredSession = {
    userId: user.id,
    username: user.loginName,
    displayName: user.displayName,
    secondUserId: second?.id ?? null,
    secondDisplayName: second?.displayName ?? null,
  };
  await keystore.setSession(session);
  setMeta('lastUserId', user.id);
  store.dispatch(signedIn(session));
}

/**
 * After every sync: apply the office's decision and the latest user list.
 * Signs out if the phone was blocked, or the signed-in salesman was disabled in VK Nex.
 */
export async function revalidateSession(): Promise<void> {
  const status = deviceStatus();
  store.dispatch(deviceStatusChanged(status));
  const current = store.getState().session.session;
  if (!current) return;
  const user = activeUser(current.userId);
  if (isBlocked(status) || !user) {
    await logout();
    return;
  }
  const next = refreshed(current, user);
  if (next.displayName !== current.displayName || next.secondUserId !== current.secondUserId) {
    await keystore.setSession(next);
    store.dispatch(signedIn(next));
  }
}

/** Number of documents that would still be waiting to upload. */
export function unsyncedCount(): number {
  const c = countByStatus();
  return c.PENDING + c.SENDING;
}

/**
 * Logout keeps unsynced documents in SQLite; they upload at the next Sync.
 * The UI should warn when unsyncedCount() > 0.
 */
export async function logout(): Promise<void> {
  await keystore.clearSession();
  store.dispatch(signedOut());
}

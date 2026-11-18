import { and, asc, eq, ne, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { getMeta, setMeta } from '@/db/meta';
import { users, type User } from '@/db/schema';
import { store } from '@/store';
import { signedIn, signedOut, type Session } from '@/store/sessionSlice';
import { getServerCredentials, setServerCredentials } from '@/sync/credentials';
import { checkLogin } from '@/sync/run-sync';
import type { ServerAddress } from '@/sync/server-address';
import { getServerAddress } from '@/sync/sync-store';
import { isApiError, isNetworkError, type ServerCredentials } from '@/sync/vk-nex-api';

import { hashPassword, verifyPassword } from './password';

/**
 * Login with the salesman's real VK Nex user (login name + password).
 *
 * The phone has no user list of its own. The first time a user logs in on this phone, VK Nex
 * checks the login name and password (POST /auth/login); the phone then keeps that user (VK Nex's
 * usr_id and login name) with its own hash of the password. From then on the same login works
 * with no server, as Sync is the only time the phone needs the office.
 */

export type LoginResult =
  | { ok: true }
  /** VK Nex refused the login name and password (wrong, locked, inactive, or no mobile login). */
  | { ok: false; reason: 'refused' }
  /** VK Nex has to check this login, and no server address is saved yet. */
  | { ok: false; reason: 'noServer' }
  /** VK Nex has to check this login and did not answer. known: the user has logged in here before. */
  | { ok: false; reason: 'offline'; known: boolean; address: ServerAddress }
  /** VK Nex answered with some other error (426 = this app is too old for it). */
  | { ok: false; reason: 'server'; status: number; message: string };

/** Login names are matched as VK Nex matches them: case ignored. */
const sameLoginName = (name: string) => sql`lower(${users.loginName}) = lower(${name})`;

function savedUser(loginName: string): User | undefined {
  return db.select().from(users).where(and(sameLoginName(loginName), eq(users.isActive, true))).get();
}

function activeUser(id: string): User | undefined {
  const u = db.select().from(users).where(eq(users.id, id)).get();
  return u?.isActive ? u : undefined;
}

/** Users who have logged in on this phone, for the second-salesman list. */
export const savedUsersQuery = () =>
  db.select({ id: users.id, loginName: users.loginName }).from(users).where(eq(users.isActive, true)).orderBy(asc(users.loginName));

/** Login name of whoever logged in last, typed in for them on the login page. */
export function lastLoginName(): string {
  const id = getMeta('lastUserId');
  return (id && activeUser(id)?.loginName) || '';
}

/** Keeps a user VK Nex has just accepted, with the phone's own hash of their password. */
function rememberUser(usrId: string, loginName: string, passwordHash: string): User {
  const row: User = { id: usrId, loginName, displayName: loginName, passwordHash, isActive: true };
  db.transaction((tx) => {
    // The same login name kept under another id: that VK Nex user was deleted and made again.
    tx.delete(users).where(and(sameLoginName(loginName), ne(users.id, usrId))).run();
    tx.insert(users)
      .values(row)
      .onConflictDoUpdate({ target: users.id, set: { loginName, displayName: loginName, passwordHash, isActive: true } })
      .run();
  });
  return row;
}

/** The credentials this login handed to Sync; Sync may later be given others on its own page. */
let loginCredentials: ServerCredentials | null = null;

/**
 * The salesman types their VK Nex login name and password. As in the old Qt app, an optional
 * second salesman can be added (multi-user mode): any other user who has logged in on this phone.
 * Only the first salesman's password is checked.
 */
export async function login(loginName: string, password: string, secondUserId?: string | null): Promise<LoginResult> {
  const name = loginName.trim();
  const saved = savedUser(name);

  let user: User;
  if (saved && (await verifyPassword(password, saved.passwordHash))) {
    user = saved;
  } else {
    // A new user on this phone, or not the password it knows (perhaps changed on VK Nex): ask VK Nex.
    const address = getServerAddress();
    if (!address) return { ok: false, reason: 'noServer' };
    let accepted: Awaited<ReturnType<typeof checkLogin>>;
    try {
      accepted = await checkLogin(address, { loginName: name, password });
    } catch (e) {
      if (isNetworkError(e)) return { ok: false, reason: 'offline', known: !!saved, address };
      if (isApiError(e) && e.status === 401) return { ok: false, reason: 'refused' };
      return { ok: false, reason: 'server', status: isApiError(e) ? e.status : 0, message: e instanceof Error ? e.message : String(e) };
    }
    if (!accepted.usrId) return { ok: false, reason: 'server', status: 0, message: 'VK Nex did not say which user signed in' };
    user = rememberUser(accepted.usrId, accepted.loginName, await hashPassword(password));
  }

  const second = secondUserId && secondUserId !== user.id ? activeUser(secondUserId) : undefined;
  const session: Session = {
    userId: user.id,
    username: user.loginName,
    displayName: user.displayName,
    secondUserId: second?.id ?? null,
    secondDisplayName: second?.displayName ?? null,
  };
  setMeta('lastUserId', user.id);
  // Every login starts the customer list with no beat ticked; the salesman chooses today's beat.
  setMeta('lastBeatIds', '');
  // Sync signs in to VK Nex as the same user; the password stays in memory only.
  loginCredentials = { loginName: user.loginName, password };
  setServerCredentials(loginCredentials);
  store.dispatch(signedIn(session));
  return { ok: true };
}

/**
 * Sync's sign-in was refused with the very password this phone logged in with: it was changed on
 * VK Nex, or the user was locked, made inactive or lost mobile login. The phone forgets that
 * password, so the next login has to be checked with VK Nex again.
 */
export function forgetRefusedLoginPassword(): void {
  const session = store.getState().session.session;
  if (!session || !loginCredentials || getServerCredentials() !== loginCredentials) return;
  db.update(users).set({ passwordHash: '' }).where(eq(users.id, session.userId)).run();
}

export function logout(): void {
  loginCredentials = null;
  setServerCredentials(null);
  store.dispatch(signedOut());
}

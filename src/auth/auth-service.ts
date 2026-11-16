import { eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { setMeta } from '@/db/meta';
import { users, type User } from '@/db/schema';
import { store } from '@/store';
import { signedIn, signedOut, type Session } from '@/store/sessionSlice';
import { setServerCredentials } from '@/sync/credentials';

import { verifyPassword } from './password';

/** Login is checked entirely on the phone, against the salesmen in the local users table. */

function activeUser(id: string): User | undefined {
  const u = db.select().from(users).where(eq(users.id, id)).get();
  return u?.isActive ? u : undefined;
}

/**
 * The salesman picks their name and types their password. As in the old Qt app, an optional
 * second salesman can be added (multi-user mode); only the first salesman's password is checked.
 * Returns false when the password is wrong (or the salesman no longer exists).
 */
export async function login(userId: string, password: string, secondUserId?: string | null): Promise<boolean> {
  const user = activeUser(userId);
  if (!user || !(await verifyPassword(password, user.passwordHash))) return false;

  const second = secondUserId && secondUserId !== user.id ? activeUser(secondUserId) : undefined;
  const session: Session = {
    userId: user.id,
    username: user.loginName,
    displayName: user.displayName,
    secondUserId: second?.id ?? null,
    secondDisplayName: second?.displayName ?? null,
  };
  setMeta('lastUserId', user.id);
  // Sync signs in to VK Nex as the same user; the password stays in memory only.
  setServerCredentials({ loginName: user.loginName, password });
  store.dispatch(signedIn(session));
  return true;
}

export function logout(): void {
  setServerCredentials(null);
  store.dispatch(signedOut());
}

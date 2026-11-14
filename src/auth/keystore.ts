import * as SecureStore from 'expo-secure-store';

/**
 * Small secrets live in the Android Keystore (expo-secure-store), never in SQLite,
 * so they stay encrypted even if someone copies the database file.
 */
const K = {
  session: 'vkfs.session',
  deviceId: 'vkfs.deviceId',
  deviceKey: 'vkfs.deviceKey',
} as const;

/** Who is signed in on this phone. Checked against the local users table, never the server. */
export interface StoredSession {
  userId: string;
  username: string;
  displayName: string;
  /** Second salesman working with them (multi-user mode). Only the first one's password is checked. */
  secondUserId?: string | null;
  secondDisplayName?: string | null;
}

export const keystore = {
  async getSession(): Promise<StoredSession | null> {
    const raw = await SecureStore.getItemAsync(K.session);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  },
  setSession: (s: StoredSession) => SecureStore.setItemAsync(K.session, JSON.stringify(s)),
  /** Logout clears the session only. Unsynced documents in SQLite are kept. */
  clearSession: () => SecureStore.deleteItemAsync(K.session),

  getDeviceId: () => SecureStore.getItemAsync(K.deviceId),
  setDeviceId: (id: string) => SecureStore.setItemAsync(K.deviceId, id),

  getDeviceKey: () => SecureStore.getItemAsync(K.deviceKey),
  setDeviceKey: (key: string) => SecureStore.setItemAsync(K.deviceKey, key),

  /** Tokens from the old online-login design. Removed on boot so they don't linger. */
  async removeLegacyTokens(): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync('vkfs.accessToken'),
      SecureStore.deleteItemAsync('vkfs.refreshToken'),
    ]);
  },
};

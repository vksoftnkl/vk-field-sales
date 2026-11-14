import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

/** New file name for the login-only app, so an older database on a test phone is never reused. */
export const DATABASE_NAME = 'vksman.db';

/** enableChangeListener lets Drizzle's useLiveQuery re-render screens when rows change. */
export const expoDb = openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });

expoDb.execSync('PRAGMA journal_mode = WAL;');

export const db = drizzle(expoDb, { schema });

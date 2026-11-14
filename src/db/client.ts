import { drizzle } from 'drizzle-orm/expo-sqlite';
import { openDatabaseSync } from 'expo-sqlite';

import * as schema from './schema';

export const DATABASE_NAME = 'vk-field-sales.db';

/**
 * One connection for the whole app (UI and background sync).
 * enableChangeListener lets Drizzle's useLiveQuery re-render screens when rows change.
 */
export const expoDb = openDatabaseSync(DATABASE_NAME, { enableChangeListener: true });

// WAL = readers don't block the writer (sync can run while a screen reads).
expoDb.execSync('PRAGMA journal_mode = WAL;');
expoDb.execSync('PRAGMA foreign_keys = ON;');

export const db = drizzle(expoDb, { schema });

export type DB = typeof db;
/** The `tx` handed to db.transaction() callbacks. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

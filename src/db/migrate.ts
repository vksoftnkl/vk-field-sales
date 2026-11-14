import { migrate } from 'drizzle-orm/expo-sqlite/migrator';

import migrations from '@drizzle/migrations';

import { db } from './client';

let running: Promise<void> | null = null;

/** Runs pending migrations once per app start. Called by the root layout. */
export function ensureMigrated(): Promise<void> {
  running ??= migrate(db, migrations).catch((e: unknown) => {
    running = null; // allow a retry
    throw e;
  });
  return running;
}

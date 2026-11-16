import { asc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { getMeta, setMeta } from '@/db/meta';
import { companies, deviceMeta } from '@/db/schema';

/**
 * The company the salesman works for right now. As in the Qt app (Constants.companyID), it is
 * one setting for the phone: new bills and receipts are made for it. Kept in device_meta.
 */

export const companiesQuery = () =>
  db
    .select({ id: companies.id, name: companies.name, place: companies.place })
    .from(companies)
    .orderBy(asc(companies.position), asc(companies.name));

/** Live: re-reads when device_meta changes, i.e. right after Switch company. */
export const currentCompanyQuery = () =>
  db
    .select({ id: companies.id, name: companies.name, place: companies.place })
    .from(deviceMeta)
    .innerJoin(companies, eq(companies.id, deviceMeta.value))
    .where(eq(deviceMeta.key, 'companyId'));

export function switchCompany(id: string): void {
  setMeta('companyId', id);
}

/** At start-up: keep the saved company if it still exists, otherwise pick the first one. */
export function ensureCurrentCompany(): void {
  const saved = getMeta('companyId');
  if (saved && db.select({ id: companies.id }).from(companies).where(eq(companies.id, saved)).get()) return;
  const first = companiesQuery().limit(1).get();
  if (first) switchCompany(first.id);
}

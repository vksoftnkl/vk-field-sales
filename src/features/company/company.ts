import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/db/client';
import { getMeta, setMeta } from '@/db/meta';
import { branches, companies, deviceMeta } from '@/db/schema';

/**
 * The company and branch the salesman works for right now, picked in Switch company. As in the
 * Qt app (Constants.companyID), it is one setting for the phone, kept in device_meta: new bills and
 * receipts are made for the company, and new orders are saved for the company and the branch.
 * The branch is never picked for the salesman: with none, Take order asks first.
 */

export const companiesQuery = () =>
  db
    .select({ id: companies.id, name: companies.name, place: companies.place })
    .from(companies)
    .orderBy(asc(companies.position), asc(companies.name));

/** A company's branches, in VK Nex's order. */
export const branchesQuery = (companyId: string) =>
  db
    .select({ id: branches.id, name: branches.name, companyId: branches.companyId, isDefault: branches.isDefault })
    .from(branches)
    .where(eq(branches.companyId, companyId))
    .orderBy(asc(branches.position), asc(branches.name));

/** Live: re-reads when device_meta changes, i.e. right after Switch company. */
export const currentCompanyQuery = () =>
  db
    .select({ id: companies.id, name: companies.name, place: companies.place })
    .from(deviceMeta)
    .innerJoin(companies, eq(companies.id, deviceMeta.value))
    .where(eq(deviceMeta.key, 'companyId'));

/** Live: the picked branch (none when no branch is picked, or it is gone after a Sync). */
export const currentBranchQuery = () =>
  db
    .select({ id: branches.id, name: branches.name, companyId: branches.companyId })
    .from(deviceMeta)
    .innerJoin(branches, eq(branches.id, deviceMeta.value))
    .where(eq(deviceMeta.key, 'branchId'));

/** One branch's name (orders show the branch they were saved for). */
export const branchQuery = (branchId: string) => db.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.id, branchId));

/** Switch company: the company and one of its branches, always together. */
export function switchCompany(companyId: string, branchId: string): void {
  db.transaction(() => {
    setMeta('companyId', companyId);
    setMeta('branchId', branchId);
  });
}

const branchOf = (companyId: string, branchId: string) =>
  !!db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.companyId, companyId)))
    .get();

/**
 * At start-up and after Sync: keep the saved company if it still exists, otherwise pick the first
 * one. The saved branch is kept only while it is still one of that company's; otherwise it is
 * cleared, so the next order asks for one.
 */
export function ensureCurrentCompany(): void {
  const saved = getMeta('companyId');
  let companyId = saved && db.select({ id: companies.id }).from(companies).where(eq(companies.id, saved)).get() ? saved : null;
  if (!companyId) {
    companyId = companiesQuery().limit(1).get()?.id ?? null;
    if (companyId) setMeta('companyId', companyId);
  }
  const branchId = getMeta('branchId');
  if (branchId && (!companyId || !branchOf(companyId, branchId))) setMeta('branchId', '');
}

/** The company and branch new orders are saved for; null while either is not picked yet. */
export function currentContext(): { companyId: string; branchId: string } | null {
  const companyId = currentCompanyQuery().get()?.id;
  const branch = currentBranchQuery().get();
  return companyId && branch && branch.companyId === companyId ? { companyId, branchId: branch.id } : null;
}

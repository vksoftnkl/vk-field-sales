import { and, asc, count, eq, inArray, or, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { beats, customerBills, customers, customerTypes, itemPriceLevels, ledgerYears } from '@/db/schema';
import { stateName } from '@/lib/gst-states';
import { uuidv7 } from '@/lib/uuid';

import type { CustomerEditForm, EditField, NewCustomerForm } from './new-customer';

/** Customer-list reads and writes. Always local SQLite, never the network. Use reads with useLiveQuery. */

export const beatsQuery = () =>
  db.select({ id: beats.id, name: beats.name }).from(beats).orderBy(asc(beats.position), asc(beats.name));

export const customerTypesQuery = () =>
  db
    .select({ id: customerTypes.id, name: customerTypes.name })
    .from(customerTypes)
    .orderBy(asc(customerTypes.position), asc(customerTypes.name));

/** Ids of beats that exist, from a saved list (a beat can disappear after a Sync). */
export function existingBeatIds(ids: readonly string[]): string[] {
  if (ids.length === 0) return [];
  const found = new Set(db.select({ id: beats.id }).from(beats).where(inArray(beats.id, [...ids])).all().map((b) => b.id));
  return ids.filter((id) => found.has(id));
}

const inBeats = (beatIds: readonly string[]) => (beatIds.length ? inArray(customers.cusAreaId, [...beatIds]) : undefined);
const ofTypes = (typeIds: readonly string[]) => (typeIds.length ? inArray(customers.cusGroupId, [...typeIds]) : undefined);
/** Live customers, as VK Nex counts them: active and not deleted. */
const live = () => and(eq(customers.cusIsActive, true), eq(customers.cusIsDeleted, false));

/**
 * What the customer owes as of the last Sync: the closing of the latest ledger year VK Nex gave
 * (VK Nex's own balance), or null when Sync brought no ledger for this customer.
 */
const ledgerBalance = sql<number | null>`(select ${ledgerYears.closingPaise} from ${ledgerYears} where ${ledgerYears.customerId} = ${customers.cusId} order by ${ledgerYears.fromDate} desc limit 1)`;

/**
 * Active shops of the ticked beats and types ([] = all), in visiting order, with their unpaid
 * bills summed up: the same shape as the Qt app's customer list query. The amount is VK Nex's
 * ledger balance once Sync has brought it, else the phone's unpaid bills.
 */
export function customerListQuery(beatIds: readonly string[], typeIds: readonly string[]) {
  return db
    .select({
      cusId: customers.cusId,
      cusCode: customers.cusCode,
      cusName: customers.cusName,
      cusShort: customers.cusShort,
      cusCity: customers.cusCity,
      cusPhone1: customers.cusPhone1,
      cusPhone2: customers.cusPhone2,
      appBilled: customers.appBilled,
      appOrderStatus: customers.appOrderStatus,
      appReceived: customers.appReceived,
      billCount: sql<number>`count(${customerBills.id})`.mapWith(Number),
      outstandingPaise: sql<number>`coalesce(${ledgerBalance}, sum(${customerBills.balancePaise}), 0)`.mapWith(Number),
      oldestBillDate: sql<string | null>`min(${customerBills.billDate})`,
    })
    .from(customers)
    .leftJoin(beats, eq(beats.id, customers.cusAreaId))
    .leftJoin(customerBills, eq(customerBills.customerId, customers.cusId))
    .where(and(live(), inBeats(beatIds), ofTypes(typeIds)))
    .groupBy(customers.cusId)
    .orderBy(asc(beats.position), asc(beats.name), asc(customers.cusSortOrder), asc(customers.cusName));
}

/** Live shops of the ticked beats and types, in visiting order, with their address: Choose customer. */
export const pickCustomersQuery = (beatIds: readonly string[], typeIds: readonly string[]) =>
  db
    .select({
      cusId: customers.cusId,
      cusCode: customers.cusCode,
      cusName: customers.cusName,
      cusShort: customers.cusShort,
      cusAddr1: customers.cusAddr1,
      cusAddr2: customers.cusAddr2,
      cusAddr3: customers.cusAddr3,
      cusCity: customers.cusCity,
      cusPin: customers.cusPin,
      cusPhone1: customers.cusPhone1,
      cusPhone2: customers.cusPhone2,
    })
    .from(customers)
    .leftJoin(beats, eq(beats.id, customers.cusAreaId))
    .where(and(live(), inBeats(beatIds), ofTypes(typeIds)))
    .orderBy(asc(beats.position), asc(beats.name), asc(customers.cusSortOrder), asc(customers.cusName));

/** Shops per beat, for the beat sheet (all types). */
export const beatCountsQuery = () =>
  db
    .select({ id: customers.cusAreaId, n: count() })
    .from(customers)
    .where(live())
    .groupBy(customers.cusAreaId);

/** Shops per type within the ticked beats, for the type sheet. */
export const typeCountsQuery = (beatIds: readonly string[]) =>
  db
    .select({ id: customers.cusGroupId, n: count() })
    .from(customers)
    .where(and(live(), inBeats(beatIds)))
    .groupBy(customers.cusGroupId);

/** Shops added and customers edited on this phone that Upload still has to send. */
export const pendingUploadQuery = () =>
  db
    .select({ n: count() })
    .from(customers)
    .where(and(or(eq(customers.appPendingUpload, true), eq(customers.appPendingUpdate, true)), eq(customers.cusIsDeleted, false)));

/** One customer for Customer detail and Edit customer, with its type and price level names. */
export const customerDetailQuery = (cusId: string) =>
  db
    .select({
      cusId: customers.cusId,
      cusName: customers.cusName,
      cusShort: customers.cusShort,
      cusCode: customers.cusCode,
      cusAddr1: customers.cusAddr1,
      cusAddr2: customers.cusAddr2,
      cusAddr3: customers.cusAddr3,
      cusCity: customers.cusCity,
      cusDistrict: customers.cusDistrict,
      cusPin: customers.cusPin,
      cusPhone1: customers.cusPhone1,
      cusPhone2: customers.cusPhone2,
      cusAadharNo: customers.cusAadharNo,
      cusPanNo: customers.cusPanNo,
      cusFreightCharge: customers.cusFreightCharge,
      cusLoadingCharge: customers.cusLoadingCharge,
      typeName: customerTypes.name,
      priceLevelName: itemPriceLevels.iplName,
      appPendingUpload: customers.appPendingUpload,
      appPendingUpdate: customers.appPendingUpdate,
      appSyncError: customers.appSyncError,
      outstandingPaise: sql<number>`coalesce(${ledgerBalance}, (select sum(${customerBills.balancePaise}) from ${customerBills} where ${customerBills.customerId} = ${customers.cusId}), 0)`.mapWith(
        Number,
      ),
    })
    .from(customers)
    .leftJoin(customerTypes, eq(customerTypes.id, customers.cusGroupId))
    .leftJoin(itemPriceLevels, eq(itemPriceLevels.iplId, customers.cusPriceLevelId))
    .where(eq(customers.cusId, cusId));

export type CustomerDetail = Awaited<ReturnType<ReturnType<typeof customerDetailQuery>['all']>>[number];

/**
 * Edit customer, saved on the phone (works offline). A VK Nex customer is marked for the next
 * Sync with the fields that changed (added to any still unsent); a shop still waiting to be
 * created goes up with these values anyway. Nothing changed = nothing to send.
 */
export function saveCustomerEdit(cusId: string, f: CustomerEditForm, changed: readonly EditField[], userId: string): void {
  if (changed.length === 0) return;
  const row = db
    .select({ isNew: customers.appPendingUpload, edited: customers.appEditedFields })
    .from(customers)
    .where(eq(customers.cusId, cusId))
    .get();
  if (!row) throw new Error('CUSTOMER_NOT_ON_PHONE');
  const edited = [...new Set([...row.edited, ...changed])];
  db.update(customers)
    .set({
      cusPhone1: f.cusPhone1 || null,
      cusPhone2: f.cusPhone2 || null,
      cusAadharNo: f.cusAadharNo || null,
      cusPanNo: f.cusPanNo || null,
      cusModifiedOn: new Date().toISOString(),
      cusModifiedBy: userId,
      // A new edit is a new try: the reason the last one was refused no longer applies.
      ...(row.isNew ? {} : { appPendingUpdate: true, appEditedFields: edited, appSyncError: null }),
    })
    .where(eq(customers.cusId, cusId))
    .run();
}

/** Is there already a live shop with this name? VK Nex refuses a second one (CUSTOMER_NAME_EXISTS). */
export function customerNameExists(name: string): boolean {
  return (
    db
      .select({ id: customers.cusId })
      .from(customers)
      .where(and(live(), sql`lower(${customers.cusName}) = lower(${name.trim()})`))
      .get() !== undefined
  );
}

/**
 * Saves a shop from the New customer form (already validated and cleaned) on the phone, at the
 * end of its beat, marked for the next Upload. Works offline; returns the new cus_id.
 */
export function addCustomer(f: NewCustomerForm, userId: string): string {
  const cusId = uuidv7();
  const last = db
    .select({ n: sql<number>`coalesce(max(${customers.cusSortOrder}), 0)`.mapWith(Number) })
    .from(customers)
    .where(eq(customers.cusAreaId, f.cusAreaId))
    .get();
  const blankToNull = (v: string) => v || null;
  db.insert(customers)
    .values({
      cusId,
      cusName: f.cusName,
      cusGroupId: f.cusGroupId,
      cusAreaId: f.cusAreaId,
      cusContactPerson: blankToNull(f.cusContactPerson),
      cusAddr1: blankToNull(f.cusAddr1),
      cusAddr2: blankToNull(f.cusAddr2),
      cusLandmark: blankToNull(f.cusLandmark),
      cusCity: blankToNull(f.cusCity),
      cusDistrict: blankToNull(f.cusDistrict),
      cusStateCode: f.cusStateCode,
      cusStateName: stateName(f.cusStateCode) ?? '',
      cusPin: blankToNull(f.cusPin),
      cusPhone1: blankToNull(f.cusPhone1),
      cusPhone2: blankToNull(f.cusPhone2),
      cusWhatsappNo: blankToNull(f.cusWhatsappNo),
      cusEmail: blankToNull(f.cusEmail),
      cusGstType: f.cusGstType,
      cusGstNo: blankToNull(f.cusGstNo),
      cusPanNo: blankToNull(f.cusPanNo),
      cusAadharNo: blankToNull(f.cusAadharNo),
      cusSortOrder: (last?.n ?? 0) + 1,
      cusCreatedBy: userId,
      cusModifiedBy: userId,
      appPendingUpload: true,
    })
    .run();
  return cusId;
}

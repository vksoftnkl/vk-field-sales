import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { beats, customerBills, customers, customerTypes } from '@/db/schema';
import { stateName } from '@/lib/gst-states';
import { uuidv7 } from '@/lib/uuid';

import type { NewCustomerForm } from './new-customer';

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
 * Active shops of the ticked beats and types ([] = all), in visiting order, with their unpaid
 * bills summed up: the same shape as the Qt app's customer list query.
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
      outstandingPaise: sql<number>`coalesce(sum(${customerBills.balancePaise}), 0)`.mapWith(Number),
      oldestBillDate: sql<string | null>`min(${customerBills.billDate})`,
    })
    .from(customers)
    .leftJoin(beats, eq(beats.id, customers.cusAreaId))
    .leftJoin(customerBills, eq(customerBills.customerId, customers.cusId))
    .where(and(live(), inBeats(beatIds), ofTypes(typeIds)))
    .groupBy(customers.cusId)
    .orderBy(asc(beats.position), asc(beats.name), asc(customers.cusSortOrder), asc(customers.cusName));
}

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

/** Shops added on this phone that Upload still has to send. */
export const pendingUploadQuery = () =>
  db.select({ n: count() }).from(customers).where(eq(customers.appPendingUpload, true));

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

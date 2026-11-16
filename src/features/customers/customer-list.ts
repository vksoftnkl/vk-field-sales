// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/** One row of the customer list, as read from SQLite (VK Nex field names, plus phone-only app_*). */
export interface CustomerRow {
  cusId: string;
  cusCode: string | null;
  cusName: string | null;
  cusShort: string | null;
  cusCity: string | null;
  cusPhone1: string | null;
  cusPhone2: string | null;
  appBilled: boolean;
  appOrderStatus: 'ordered' | 'no_order' | null;
  appReceived: boolean;
  billCount: number;
  outstandingPaise: number;
  /** YYYY-MM-DD of the oldest unpaid bill, null when there is none. */
  oldestBillDate: string | null;
}

export type VisitStatus = 'billed' | 'ordered' | 'received' | 'noOrder' | 'notVisited';

/**
 * The one chip shown per shop. A bill beats an order, an order beats a collection, and a
 * collection says more than "visited, no order".
 */
export function visitStatus(c: Pick<CustomerRow, 'appBilled' | 'appOrderStatus' | 'appReceived'>): VisitStatus {
  if (c.appBilled) return 'billed';
  if (c.appOrderStatus === 'ordered') return 'ordered';
  if (c.appReceived) return 'received';
  if (c.appOrderStatus === 'no_order') return 'noOrder';
  return 'notVisited';
}

/**
 * Quick filters from the filter button, as in the Qt app's popup:
 *  - notBilled ("Un-billed"): no bill and no order on this trip yet (shops that said "no order"
 *    stay in, as they still need one).
 *  - notCollected ("No collection"): still owes money and nothing was collected on this trip.
 */
export type QuickFilter = 'all' | 'notBilled' | 'notCollected';

export const QUICK_FILTERS: readonly QuickFilter[] = ['all', 'notBilled', 'notCollected'];

function passesQuick(c: CustomerRow, quick: QuickFilter): boolean {
  switch (quick) {
    case 'notBilled':
      return !c.appBilled && c.appOrderStatus !== 'ordered';
    case 'notCollected':
      return c.outstandingPaise > 0 && !c.appReceived;
    default:
      return true;
  }
}

/**
 * Search box + quick filter. Case-insensitive; every typed word must appear in the shop's
 * name, short name, city (area), phones or code ("murugan namak" finds Sri Murugan Stores in Namakkal).
 */
export function filterCustomers<T extends CustomerRow>(rows: readonly T[], query: string, quick: QuickFilter): T[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((c) => {
    if (!passesQuick(c, quick)) return false;
    if (words.length === 0) return true;
    const hay = [c.cusName, c.cusShort, c.cusCity, c.cusPhone1, c.cusPhone2, c.cusCode].filter(Boolean).join(' ').toLocaleLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** How many of these shops each quick filter would show (the counts in the filter sheet). */
export function countByQuickFilter(rows: readonly CustomerRow[]): Record<QuickFilter, number> {
  const counts: Record<QuickFilter, number> = { all: 0, notBilled: 0, notCollected: 0 };
  for (const c of rows) for (const q of QUICK_FILTERS) if (passesQuick(c, q)) counts[q] += 1;
  return counts;
}

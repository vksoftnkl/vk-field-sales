import { asc, eq, sql } from 'drizzle-orm';

import { db } from '@/db/client';
import { fiscalYears, ledgerRows, ledgerYears } from '@/db/schema';

/** The Ledger statement's reads: always local SQLite (Sync brings the ledger). Use with useLiveQuery. */

/** A customer's downloaded years, with the financial year's first and last day. */
export const ledgerYearsQuery = (cusId: string) =>
  db
    .select({
      accYear: ledgerYears.accYear,
      beginDate: sql<string>`coalesce(${fiscalYears.fyBeginDate}, ${ledgerYears.fromDate})`,
      endDate: sql<string>`coalesce(${fiscalYears.fyEndDate}, ${ledgerYears.toDate})`,
      openingPaise: ledgerYears.openingPaise,
      closingPaise: ledgerYears.closingPaise,
      toDate: ledgerYears.toDate,
      syncedOn: ledgerYears.syncedOn,
    })
    .from(ledgerYears)
    .leftJoin(fiscalYears, eq(fiscalYears.fyYearName, ledgerYears.accYear))
    .where(eq(ledgerYears.customerId, cusId))
    .orderBy(asc(ledgerYears.fromDate));

export const ledgerRowsQuery = (cusId: string) =>
  db
    .select({
      voucherId: ledgerRows.voucherId,
      accYear: ledgerRows.accYear,
      seq: ledgerRows.seq,
      date: ledgerRows.date,
      voucherTypeName: ledgerRows.voucherTypeName,
      voucherNo: ledgerRows.voucherNo,
      rowKind: ledgerRows.rowKind,
      particulars: ledgerRows.particulars,
      narration: ledgerRows.narration,
      srcModule: ledgerRows.srcModule,
      srcDocType: ledgerRows.srcDocType,
      billRefs: ledgerRows.billRefs,
      debitPaise: ledgerRows.debitPaise,
      creditPaise: ledgerRows.creditPaise,
      balancePaise: ledgerRows.balancePaise,
    })
    .from(ledgerRows)
    .where(eq(ledgerRows.customerId, cusId))
    .orderBy(asc(ledgerRows.accYear), asc(ledgerRows.seq));

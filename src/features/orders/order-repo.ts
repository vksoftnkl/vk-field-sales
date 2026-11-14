import { and, desc, eq, inArray } from 'drizzle-orm';

import { db } from '@/db/client';
import { customers, itemPrices, items, orderLines, orders, type Item } from '@/db/schema';
import { computeBill, isInterState, type LineInput } from '@/domain/pricing';
import { todayISO } from '@/lib/money';
import { uuidv7 } from '@/lib/uuid';
import { enqueue } from '@/sync/outbox';

export interface DraftLine {
  itemId: string;
  qty: number;
  ratePaise: number;
  discBp?: number;
}

export interface CreateOrderInput {
  customerId: string;
  /** users.id of the signed-in salesman. Sent to VK Nex so it knows who took the order. */
  createdBy: string;
  /** Optional second salesman (multi-user mode). */
  secondUserId?: string | null;
  lines: DraftLine[];
  remarks?: string;
  companyStateCode: string | null;
}

/** Rate for an item at the customer's price level, falling back to MRP. */
export function resolveRate(item: Item, priceLevel: string | null): number {
  if (priceLevel) {
    const row = db
      .select({ rate: itemPrices.ratePaise })
      .from(itemPrices)
      .where(and(eq(itemPrices.itemId, item.id), eq(itemPrices.priceLevel, priceLevel)))
      .get();
    if (row) return row.rate;
  }
  return item.mrpPaise;
}

/**
 * Save an order and queue it for upload — in ONE transaction.
 * Either the order, its lines and its outbox row are all saved, or none are.
 */
export function createOrder(input: CreateOrderInput): string {
  if (!input.lines.length) throw new Error('Add at least one item');

  const customer = db.select().from(customers).where(eq(customers.id, input.customerId)).get();
  if (!customer) throw new Error('Customer not found');

  const itemRows = db.select().from(items).where(inArray(items.id, input.lines.map((l) => l.itemId))).all();
  const itemById = new Map(itemRows.map((i) => [i.id, i]));

  const interState = isInterState(input.companyStateCode, customer.stateCode);
  const pricingLines: LineInput[] = input.lines.map((l) => {
    const item = itemById.get(l.itemId);
    if (!item) throw new Error(`Item ${l.itemId} not found`);
    return {
      qty: l.qty,
      ratePaise: l.ratePaise,
      discBp: l.discBp ?? 0,
      gstRateBp: item.gstRateBp,
      cessRateBp: item.cessRateBp,
      taxInclusive: item.taxInclusive,
    };
  });
  const bill = computeBill(pricingLines, interState);

  const clientUuid = uuidv7();
  const orderDate = todayISO();

  db.transaction((tx) => {
    tx.insert(orders)
      .values({
        clientUuid,
        customerId: customer.id,
        createdBy: input.createdBy,
        secondUserId: input.secondUserId ?? null,
        orderDate,
        interState,
        taxablePaise: bill.taxablePaise,
        taxPaise: bill.taxPaise,
        roundOffPaise: bill.roundOffPaise,
        totalPaise: bill.totalPaise,
        remarks: input.remarks ?? null,
      })
      .run();

    input.lines.forEach((l, i) => {
      const r = bill.lines[i]!;
      const p = pricingLines[i]!;
      tx.insert(orderLines)
        .values({
          id: uuidv7(),
          orderUuid: clientUuid,
          lineNo: i + 1,
          itemId: l.itemId,
          qty: l.qty,
          ratePaise: l.ratePaise,
          discBp: p.discBp ?? 0,
          gstRateBp: p.gstRateBp,
          cessRateBp: p.cessRateBp ?? 0,
          taxablePaise: r.taxablePaise,
          cgstPaise: r.cgstPaise,
          sgstPaise: r.sgstPaise,
          igstPaise: r.igstPaise,
          cessPaise: r.cessPaise,
          totalPaise: r.totalPaise,
        })
        .run();
    });

    // Server recalculates everything; device totals are sent so mismatches can be flagged.
    enqueue(tx, 'order', clientUuid, {
      clientUuid,
      customerId: customer.id,
      createdBy: input.createdBy,
      secondUserId: input.secondUserId ?? null,
      orderDate,
      remarks: input.remarks ?? null,
      lines: input.lines.map((l, i) => ({ lineNo: i + 1, itemId: l.itemId, qty: l.qty, ratePaise: l.ratePaise, discBp: l.discBp ?? 0 })),
      deviceTotals: { taxablePaise: bill.taxablePaise, taxPaise: bill.taxPaise, roundOffPaise: bill.roundOffPaise, totalPaise: bill.totalPaise },
    });
  });

  return clientUuid;
}

/** Query builders for screens (use with useLiveQuery). */
export const orderQueries = {
  recent: (limit = 50) =>
    db
      .select({
        clientUuid: orders.clientUuid,
        orderNo: orders.orderNo,
        orderDate: orders.orderDate,
        status: orders.status,
        totalPaise: orders.totalPaise,
        customerName: customers.name,
      })
      .from(orders)
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .orderBy(desc(orders.createdAt))
      .limit(limit),
};

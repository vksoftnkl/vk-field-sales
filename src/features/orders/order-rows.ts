// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
//
// The rows Save order writes: the paid lines (amounts from the priced line, so the scheme money is
// in them), the free lines right after the line that earned them, and the header's offer sums.
// Also what Edit and Repeat do with a saved order's free lines: they are never copied back, the
// offers are worked out again.
import { lineTakesOffers, type ItemAttrs, type OrderFreeLine, type SchemeOrder } from '../schemes/scheme-order.ts';
import { taxRate } from '../sales/sale-math.ts';
import type { SoLine } from './order-draft.ts';
import { paiseText, qtyText, toPaise } from './order-math.ts';
import { soLineAmounts, soTotals, type SoTotals } from './so-math.ts';

/** '5.000' → '2.5' (CGST and SGST each take half). */
const halfRate = (perc: string | null): string => String(Number((taxRate(perc) / 2).toFixed(4)));

/** What a free line's unit is on the phone: the company's item_units row for (free item, unit master). */
export interface FreeUnit {
  /** item_units.iuc_id: what soi_item_unit_id takes. */
  iucId: string;
  unitName: string;
  /** Base units in one of this unit. */
  factor: string;
}

/** One sale_order_item row's values (the columns the phone fills). */
export function soItemRow(soId: string, id: string, lineNo: number, l: SoLine, a: ReturnType<typeof soLineAmounts>, promo: boolean, ls: SchemeOrder['lines'][number]) {
  const rate = taxRate(l.taxPerc);
  const withScheme = ls.scheme !== null || ls.schemeId !== null;
  return {
    soiId: id,
    soiOrderId: soId,
    soiLineNo: lineNo,
    soiItemId: l.itemId,
    soiItemUnitId: l.iucId,
    soiPriceLevel: l.priceLevel,
    soiIsPromo: promo,
    soiOrderQty: qtyText(a.qty),
    soiNetQty: qtyText(a.qty),
    soiRate: paiseText(toPaise(l.price) ?? 0),
    soiMaxPrice: l.mrp ?? '0',
    soiMinPrice: l.minPrice,
    soiItemDiscPerc: l.discMode === 'perc' ? l.disc.trim() || '0' : '0',
    soiItemDiscQty: l.discMode === 'perUnit' ? l.disc.trim() || '0' : '0',
    soiItemDiscAmt: paiseText(a.discPaise),
    soiGrossAmt: paiseText(a.grossPaise),
    soiFreightQty: a.freightPaise > 0 ? qtyText(a.qty) : '0',
    soiFreightAmt: paiseText(a.freightPaise),
    soiLoadQty: a.loadPaise > 0 ? qtyText(a.qty) : '0',
    soiLoadAmt: paiseText(a.loadPaise),
    soiNetAmt: paiseText(a.netPaise),
    soiToBaseFactor: l.factor,
    soiHsnCode: l.hsnCode,
    soiTaxId: l.taxId,
    soiIsTaxIncl: l.inclTax,
    soiTaxableAmt: paiseText(a.taxablePaise),
    soiTaxPerc: String(rate),
    soiTaxAmt: paiseText(a.taxPaise),
    soiCgstPerc: halfRate(l.taxPerc),
    soiCgstAmt: paiseText(a.cgstPaise),
    soiSgstPerc: halfRate(l.taxPerc),
    soiSgstAmt: paiseText(a.sgstPaise),
    soiIgstPerc: '0',
    soiIgstAmt: paiseText(a.igstPaise),
    // Offers: a paid line's scheme (null when it has none, so the upload leaves the keys out).
    soiIsFree: false,
    soiFreeType: null as string | null,
    soiSchemeId: withScheme ? ls.schemeId : null,
    soiSchemeName: withScheme ? ls.schemeName : null,
    soiSchDiscPerc: withScheme ? ls.schDiscPerc : null,
    soiSchDiscQty: withScheme ? ls.schDiscQty : null,
    soiSchDiscAmt: withScheme ? ls.schDiscAmt : null,
    soiBillSchPerc: withScheme ? ls.billSchPerc : null,
    soiBillSchAmt: withScheme ? ls.billSchAmt : null,
    appItemName: l.name,
    appItemNameTa: l.nameTa,
    appUnitName: l.unitName,
    appDiscMode: l.discMode,
  };
}

/** A free line's row: rate 0, no money, no tax; type SCHEME with the scheme's id and name. */
export function freeItemRow(soId: string, id: string, lineNo: number, f: OrderFreeLine, unit: FreeUnit) {
  return {
    soiId: id,
    soiOrderId: soId,
    soiLineNo: lineNo,
    soiItemId: f.freeItemId,
    soiItemUnitId: unit.iucId,
    soiPriceLevel: null as number | null,
    soiIsPromo: false,
    soiOrderQty: f.qtyText,
    soiNetQty: f.qtyText,
    soiRate: '0.00',
    soiMaxPrice: '0',
    soiMinPrice: null as string | null,
    soiItemDiscPerc: '0',
    soiItemDiscQty: '0',
    soiItemDiscAmt: '0.00',
    soiGrossAmt: '0.00',
    soiFreightQty: '0',
    soiFreightAmt: '0.00',
    soiLoadQty: '0',
    soiLoadAmt: '0.00',
    soiNetAmt: '0.00',
    soiToBaseFactor: unit.factor,
    soiHsnCode: null as string | null,
    soiTaxId: null as string | null,
    soiIsTaxIncl: false,
    soiTaxableAmt: '0.00',
    soiTaxPerc: '0',
    soiTaxAmt: '0.00',
    soiCgstPerc: '0',
    soiCgstAmt: '0.00',
    soiSgstPerc: '0',
    soiSgstAmt: '0.00',
    soiIgstPerc: '0',
    soiIgstAmt: '0.00',
    soiIsFree: true,
    soiFreeType: 'SCHEME' as string | null,
    soiSchemeId: f.schemeId as string | null,
    soiSchemeName: f.schemeName as string | null,
    soiSchDiscPerc: null as string | null,
    soiSchDiscQty: null as string | null,
    soiSchDiscAmt: null as string | null,
    soiBillSchPerc: null as string | null,
    soiBillSchAmt: null as string | null,
    appItemName: f.freeItemName,
    appItemNameTa: null as string | null,
    appUnitName: unit.unitName || f.freeUnitName,
    appDiscMode: 'perc' as string | null,
  };
}

export interface OrderRows {
  /** Paid lines, each followed by the free lines it earned; free lines with no trigger last. Numbered 1.. in this order. */
  rows: (ReturnType<typeof soItemRow> | ReturnType<typeof freeItemRow>)[];
  totals: SoTotals;
  /** so_sch_disc / so_bill_sch_disc, 2 decimals. */
  schDisc: string;
  billSchDisc: string;
  /** Free lines left out because the company has no item_units row for them: tell the salesman. */
  missingFree: OrderFreeLine[];
}

/**
 * The lines and header sums for Save. `lines` are the paid lines the offers were worked out on
 * (the same array, same order). The totals come from the priced lines, so they include the scheme
 * money; they count paid lines only (the server recomputes its item roll-up itself).
 */
export function buildOrderRows(a: {
  soId: string;
  lines: readonly SoLine[];
  order: SchemeOrder;
  itemAttrs: Readonly<Record<string, ItemAttrs>>;
  offersOn: Readonly<Record<string, boolean>>;
  /**
   * The order's Apply offers switch. Off: every paid line goes with soiIsPromo = false, so the
   * office bill (which works offers out again from each line's flag) gives none either.
   */
  applyOffers: boolean;
  resolveFree: (f: OrderFreeLine) => FreeUnit | null;
  newId: () => string;
}): OrderRows {
  const { lines, order } = a;
  const missingFree: OrderFreeLine[] = [];
  const rows: OrderRows['rows'] = [];
  const freeAfter = (i: number | null): void => {
    for (const f of order.freeLines) {
      if (f.afterIndex !== i) continue;
      const unit = a.resolveFree(f);
      if (!unit) {
        missingFree.push(f);
        continue;
      }
      rows.push(freeItemRow(a.soId, a.newId(), rows.length + 1, f, unit));
    }
  };
  lines.forEach((l, i) => {
    const priced = order.priced[i]!;
    rows.push(soItemRow(a.soId, a.newId(), rows.length + 1, priced, soLineAmounts(priced), a.applyOffers && lineTakesOffers(l, a.itemAttrs[l.itemId], a.offersOn), order.lines[i]!));
    freeAfter(i);
  });
  freeAfter(null);
  const totals = soTotals(order.priced);
  return {
    rows,
    totals,
    schDisc: paiseText(totals.schemeDiscPaise),
    billSchDisc: paiseText(totals.billSchemeDiscPaise),
    missingFree,
  };
}

/** A saved order's paid lines only: its free lines are worked out again, never loaded or copied. */
export function paidRows<T extends { line: { soiIsFree: boolean } }>(rows: readonly T[]): T[] {
  return rows.filter((r) => !r.line.soiIsFree);
}

/**
 * The "Offers on this line" switches of a saved order, by line key (the line's iucId): a paid
 * line saved with offers off while the shop and the item allow them was switched off by the salesman.
 */
export function offersOnFromSaved(lines: readonly { iucId: string; savedPromo: boolean; allowed: boolean }[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const l of lines) if (l.allowed && !l.savedPromo) out[l.iucId] = false;
  return out;
}

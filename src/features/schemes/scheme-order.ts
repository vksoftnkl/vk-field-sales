// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
//
// The adapter between the phone's order lines and the promotion engine: the role the desktop's
// SalesPromotionBinder plays (readLines / candidates / writeBack), without a grid. It reads the
// order into engine lines, runs the engine, and hands back, per paid line, the scheme fields the
// order saves, plus the free lines, plus what the screens need: badgesFor(), explain(), orderOffers().
//
// Pure and derived: the same input gives the same answer, nothing is stored. The scheme result is
// worked out again from the draft whenever it changes.
//
// What the caller must supply, beyond the order lines and the scheme rows:
//  - `itemAttrs`: per itemId, its group / brand / category / section ids and allowPromo (item_master:
//    itemGroupId, itemBrandId, itemCategoryId, itemSectionId, itemAllowPromo).
//  - `unitIds`: per iucId, the unit id offers compare. VK Nex's pri_unit_id and prs_free_unit_id
//    are item_unit_conversion ids (checked live 2026-11-19), i.e. the phone's iucId, so the
//    loader passes the iucId itself; an ITEM row binds that exact unit ("10 PCS", not "10 BOX"). A line whose unit is unknown ('') matches any
//    ITEM row unit, as the Qt engine does for an empty unit.
//  - for a free line: the engine answers with the free item and its unit (an iucId); the save code
//    checks it is one of the free item's item_units rows in the company (else matches by unit name).
import type { SoLine } from '../orders/order-draft.ts';
import { num, paiseText, qtyText } from '../orders/order-math.ts';
import { soLineAmounts, type SoSchemeOutcome } from '../orders/so-math.ts';
import { taxRate } from '../sales/sale-math.ts';
import { compileSchemes, evaluate } from './scheme-engine.ts';
import { branchQualifies, customerQualifies, isSet, itemReach, liveFail, measuresMoney } from './scheme-rules.ts';
import { PromoCode, type LiveFail, type PromoDocContext, type PromoLine, type PromoScheme, type SchemeInput, type SchemeTrace, type SkipWhy } from './scheme-types.ts';

/** What the phone knows about an item that scheme scopes read (item_master). */
export interface ItemAttrs {
  groupId: string | null;
  brandId: string | null;
  categoryId: string | null;
  sectionId: string | null;
  allowPromo: boolean;
}

/** The order's context (the desktop's PromoDocContext, from the draft). */
export interface SchemeOrderContext {
  companyId: string;
  branchId: string | null;
  customerId: string;
  custGroupId: string | null;
  areaId: string | null;
  cityId: string | null;
  priceLevelId: number | null;
  /** The order's date, YYYY-MM-DD. */
  date: string;
  /** The phone clock, HH:MM:SS. */
  time: string;
  /** Always 'CREDIT' on the phone. */
  billType: string;
}

export interface SchemeOrderInput {
  lines: readonly SoLine[];
  /** The company's scheme rows (the loader's output); compiled once per array. */
  schemes: readonly SchemeInput[];
  /** The per-line "Offers on this line" switch, by itemId (one line per item). A missing key = on. */
  offersOn?: Readonly<Record<string, boolean>>;
  /** The order's Apply offers switch. */
  applyOffers: boolean;
  context: SchemeOrderContext;
  itemAttrs: Readonly<Record<string, ItemAttrs>>;
  /** iucId -> the unit id offers compare (the iucId itself). */
  unitIds: Readonly<Record<string, string>>;
}

/** What one paid line saves (soi_scheme_id ... soi_bill_sch_amt) and what so-math takes. */
export interface LineScheme {
  /** For soLineAmounts / soTotals; null = the line takes no offer money. */
  scheme: SoSchemeOutcome | null;
  schemeId: string | null;
  schemeName: string | null;
  /** soi_sch_disc_perc / _qty: the rates ('3', '0'). */
  schDiscPerc: string;
  schDiscQty: string;
  /** soi_sch_disc_amt: the scheme rupees ('24.84'); soi_bill_sch_perc / _amt likewise. */
  schDiscAmt: string;
  billSchPerc: string;
  billSchAmt: string;
  schemePaise: number;
  billSchemePaise: number;
}

/** A free line the order must carry: its own line, rate 0, soi_is_free, soi_free_type SCHEME. */
export interface OrderFreeLine {
  freeItemId: string;
  /** The offer's unit: an item_unit_conversion id (the phone's iucId); the save code checks it is the company's. */
  freeUnitId: string;
  freeItemName: string;
  freeUnitName: string;
  qty: number;
  qtyText: string;
  schemeId: string;
  schemeName: string;
  stockCheck: boolean;
  /** The paid line it sits after (index into the lines passed in); null = append at the end. */
  afterIndex: number | null;
  afterItemId: string | null;
}

export type OfferReason =
  | 'applied'
  | 'offersOff' // the order's Apply offers switch is off
  | 'notOnOrder' // the item is not on the order
  | 'lineOff' // the line's own switch is off, or the shop or the item does not take offers
  | 'ownDiscount' // the salesman's own discount stops this offer
  | 'claimed' // an earlier exclusive offer already has the line
  | 'unit' // the offer is for another unit
  | 'lineMinQty' // below the item's own minimum quantity
  | 'notListed'
  | 'excluded'
  | LiveFail
  | 'branch'
  | 'customer'
  | 'minQty'
  | 'minAmount'
  | 'noBand' // below the first band (or between bands)
  | 'noPayout'
  | 'noFreeItem'
  | 'noBenefit'
  | 'noRate'
  | 'noLine'; // the offer found no line to count

export interface BandView {
  exceeds: number;
  /** null = open-ended. */
  upto: number | null;
  current: boolean;
}

/** Where the next offer step is and how much more it takes, in the offer's own unit. */
export interface NextStep {
  at: number;
  more: number;
}

interface OfferBase {
  schemeId: string;
  code: string;
  name: string;
  benefit: string;
  applyOn: string;
  stackMode: string;
  /** Gives something on this order now. */
  applied: boolean;
  reason: OfferReason;
  /** 'money' (*_AMOUNT, rupees) or 'qty' (*_QTY). */
  unit: 'money' | 'qty';
  /** What the offer counts on this order (all the lines it counts together). */
  measure: number;
  /** The next band's start and how much more reaches it; null = none above. */
  nextBand: NextStep | null;
  /** For a repeating band, the next whole step (buy 10 get 1: 30). */
  nextRepeat: NextStep | null;
  /** How much more the offer's own minimum quantity / minimum bill amount needs (0 = reached). */
  minQtyShort: number;
  minBillShort: number;
  /** How many times the current band pays out. */
  payouts: number;
  bands: BandView[];
}

/** An offer that names an item (a LIST scheme), for the Offers card. */
export interface ItemOffer extends OfferBase {
  /** Items counted together with it, from the order's lines. */
  countedItemIds: string[];
  /** How much more of THIS item its own minimum quantity (pri_min_qty) needs. */
  lineMinQtyShort: number;
}

/** A whole-order offer (item scope ALL) and its gap. */
export type OrderOffer = OfferBase;

export interface ItemBadge {
  schemeId: string;
  code: string;
  name: string;
  benefit: string;
  applyOn: string;
  /** Gives something on this order now (green with a tick); false = outlined. */
  applied: boolean;
  /** For the badge's words: the bands (the one in force marked) and how many times the band pays out. */
  bands: BandView[];
  payouts: number;
}

export interface SchemeOrder {
  /** One per input line, same order. */
  lines: LineScheme[];
  freeLines: OrderFreeLine[];
  /** Σ line scheme rupees / Σ bill-scheme rupees (paise), and the free quantity. */
  schemeDiscPaise: number;
  billSchemeDiscPaise: number;
  freeQty: number;
  /** The names of the offers that gave something, in the order they ran. */
  appliedNames: string[];
  notes: string[];
  /** The input lines with their scheme outcome attached, ready for soLineAmounts / soTotals. */
  priced: SoLine[];
  /** Which LIST offers reach each item, and whether each gives something now. */
  badgesFor(itemIds: readonly string[]): Record<string, ItemBadge[]>;
  /** The offers naming an item: applied, or why not, with the next band. */
  explain(itemId: string): ItemOffer[];
  /** The whole-order offers (item scope ALL) and their gap. */
  orderOffers(): OrderOffer[];
  /** The compiled scheme (for the details sheet). */
  scheme(schemeId: string): PromoScheme | undefined;
}

const compiled = new WeakMap<readonly SchemeInput[], PromoScheme[]>();

/** Parse and sort a company's scheme rows once per array. */
export function compiledSchemes(inputs: readonly SchemeInput[]): PromoScheme[] {
  let c = compiled.get(inputs);
  if (!c) {
    c = compileSchemes(inputs);
    compiled.set(inputs, c);
  }
  return c;
}

const rate4 = (n: number): string => String(Number(n.toFixed(4)));
const round3 = (n: number): number => Number(n.toFixed(3));

const NO_OUTCOME = (): LineScheme => ({
  scheme: null,
  schemeId: null,
  schemeName: null,
  schDiscPerc: '0',
  schDiscQty: '0',
  schDiscAmt: '0.00',
  billSchPerc: '0',
  billSchAmt: '0.00',
  schemePaise: 0,
  billSchemePaise: 0,
});

/**
 * Whether offers may apply to a line: the shop and the item allow them (`promo`, and the item's own
 * flag when known) and the line's own switch is not off. The save writes this as soi_is_promo.
 */
export function lineTakesOffers(l: Pick<SoLine, 'itemId' | 'promo'>, attrs: ItemAttrs | undefined, offersOn: Readonly<Record<string, boolean>> | undefined): boolean {
  return l.promo && (attrs?.allowPromo ?? true) && (offersOn?.[l.itemId] ?? true);
}

/** The engine's view of one order line (SalesPromotionBinder::readLines), worked from the phone's own line money. */
function promoLine(l: SoLine, row: number, input: SchemeOrderInput): PromoLine {
  const a = soLineAmounts({ ...l, scheme: null });
  const r = taxRate(l.taxPerc);
  const exTax = l.inclTax && r > 0 ? 100 / (100 + r) : 1; // an inclusive rate carries its tax: strip it before measuring
  const attrs = input.itemAttrs[l.itemId];
  const netGross = a.taxablePaise / 100; // ex-tax, after the salesman's own discount
  return {
    row,
    itemId: l.itemId,
    unitId: input.unitIds[l.iucId] ?? '',
    groupId: attrs?.groupId ?? '',
    categoryId: attrs?.categoryId ?? '',
    brandId: attrs?.brandId ?? '',
    sectionId: attrs?.sectionId ?? '',
    netQty: num(l.qty),
    rate: num(l.price), // FIXED_PRICE measures against the typed rate (tax-inclusive when the item is)
    gross: (a.grossPaise * exTax) / 100,
    netGross,
    taxable: netGross,
    // The shop and the item both allow offers, and the line's own switch is on.
    schemeFlag: lineTakesOffers(l, attrs, input.offersOn),
    isFree: false,
    hasManualDisc: num(l.disc) > 0,
  };
}

function docContext(input: SchemeOrderInput): PromoDocContext {
  const c = input.context;
  return {
    compId: c.companyId,
    branchId: c.branchId ?? '',
    docDate: c.date,
    docTime: c.time,
    billType: c.billType,
    custId: c.customerId,
    custGroupId: c.custGroupId ?? '',
    areaId: c.areaId ?? '',
    cityId: c.cityId ?? '',
    priceLevelId: c.priceLevelId ?? 0,
    promotionsEnabled: input.applyOffers,
  };
}

/** The first document-level check an offer fails for this order, or null (live, branch and shop fit). */
function gateFail(s: PromoScheme, ctx: PromoDocContext): LiveFail | 'branch' | 'customer' | null {
  const f = liveFail(s, ctx);
  if (f !== null) return f;
  if (!branchQualifies(s, ctx)) return 'branch';
  if (!customerQualifies(s, ctx)) return 'customer';
  return null;
}

const SKIP_REASON: Record<SkipWhy, OfferReason> = {
  flagOff: 'lineOff',
  claimed: 'claimed',
  manualDisc: 'ownDiscount',
  excluded: 'excluded',
  unit: 'unit',
  lineMinQty: 'lineMinQty',
  notListed: 'notListed',
};

/** Work out the offers on an order. */
export function evaluateOrder(input: SchemeOrderInput): SchemeOrder {
  const schemes = compiledSchemes(input.schemes);
  const ctx = docContext(input);
  const byId = new Map<string, PromoScheme>(schemes.map((s) => [s.id, s]));

  // Lines with a quantity go to the engine; `row` is the index in the order's lines.
  const eng: PromoLine[] = [];
  input.lines.forEach((l, i) => {
    if (num(l.qty) > 0) eng.push(promoLine(l, i, input));
  });
  const result = evaluate(eng, ctx, schemes);
  const traceOf = new Map<string, SchemeTrace>(result.traces.map((t) => [t.schemeId, t]));

  // --- per paid line: the scheme fields the order saves -----------------------------------
  const lines: LineScheme[] = input.lines.map(() => NO_OUTCOME());
  const priced: SoLine[] = input.lines.map((l) => ({ ...l, scheme: null }));
  let schemeDiscPaise = 0;
  let billSchemeDiscPaise = 0;
  const appliedNames: string[] = [];
  for (const o of result.lines) {
    const touched = o.schPerc !== 0 || o.schPerQty !== 0 || o.schAmt !== 0 || o.billSchPerc !== 0 || o.hasFixedPrice;
    if (!touched && o.schemeId === '') continue;
    const line = input.lines[o.row]!;
    const outcome: SoSchemeOutcome = {
      schPerc: o.schPerc,
      schPerQty: o.schPerQty,
      schAmt: o.schAmt,
      billSchPerc: o.billSchPerc,
    };
    const a = soLineAmounts({ ...line, scheme: outcome });
    lines[o.row] = {
      scheme: outcome,
      schemeId: o.schemeId || null,
      schemeName: o.schemeName || null,
      schDiscPerc: rate4(o.schPerc),
      schDiscQty: rate4(o.schPerQty),
      schDiscAmt: paiseText(a.schemePaise),
      billSchPerc: rate4(o.billSchPerc),
      billSchAmt: paiseText(a.billSchemePaise),
      schemePaise: a.schemePaise,
      billSchemePaise: a.billSchemePaise,
    };
    priced[o.row] = { ...line, scheme: outcome };
    schemeDiscPaise += a.schemePaise;
    billSchemeDiscPaise += a.billSchemePaise;
    if (touched && o.schemeName !== '') {
      for (const n of o.schemeName.split(' + ')) if (n !== '' && !appliedNames.includes(n)) appliedNames.push(n);
    }
  }

  // --- free lines -------------------------------------------------------------------------
  const freeLines: OrderFreeLine[] = result.freeLines.map((f) => ({
    freeItemId: f.itemId,
    freeUnitId: f.unitId,
    freeItemName: f.itemName,
    freeUnitName: f.unitName,
    qty: f.qty,
    qtyText: qtyText(f.qty),
    schemeId: f.schemeId,
    schemeName: f.schemeName,
    stockCheck: f.stockCheck,
    afterIndex: f.afterRow >= 0 ? f.afterRow : null,
    afterItemId: f.afterRow >= 0 ? (input.lines[f.afterRow]?.itemId ?? null) : null,
  }));
  for (const f of result.freeLines) if (f.schemeName !== '' && !appliedNames.includes(f.schemeName)) appliedNames.push(f.schemeName);

  // --- reading the result -----------------------------------------------------------------
  const gates = new Map<string, LiveFail | 'branch' | 'customer' | null>(schemes.map((s) => [s.id, gateFail(s, ctx)]));
  const engIndexOfItem = (itemId: string): number => eng.findIndex((l) => l.itemId === itemId);

  const bandsOf = (s: PromoScheme, t: SchemeTrace | undefined): BandView[] =>
    [...s.slabs]
      .sort((a, b) => a.exceeds - b.exceeds)
      .map((b) => ({
        exceeds: b.exceeds,
        upto: b.hasUpto ? b.upto : null,
        current: t?.band === b,
      }));

  const base = (s: PromoScheme, t: SchemeTrace | undefined, applied: boolean, reason: OfferReason): OfferBase => {
    const measure = t?.measure ?? 0;
    const band = t?.band ?? null;
    let nextBand: NextStep | null = null;
    for (const b of s.slabs) if (b.exceeds > measure && (!nextBand || b.exceeds < nextBand.at)) nextBand = { at: b.exceeds, more: round3(b.exceeds - measure) };
    let nextRepeat: NextStep | null = null;
    if (band && band.isRepeat && t) {
      const nextTimes = t.payouts + 1;
      const at = nextTimes * band.each;
      if ((band.maxRepeats <= 0 || nextTimes <= band.maxRepeats) && (!band.hasUpto || at <= band.upto)) nextRepeat = { at, more: round3(at - measure) };
    }
    return {
      schemeId: s.id,
      code: s.code,
      name: s.name,
      benefit: s.benefit,
      applyOn: s.applyOn,
      stackMode: s.stackMode,
      applied,
      reason,
      unit: measuresMoney(s) ? 'money' : 'qty',
      measure: round3(measure),
      nextBand,
      nextRepeat,
      minQtyShort: t && isSet(s.minQty) ? round3(Math.max(0, s.minQty - t.qty)) : isSet(s.minQty) ? s.minQty : 0,
      minBillShort: t && isSet(s.minBillAmount) ? round3(Math.max(0, s.minBillAmount - t.money)) : isSet(s.minBillAmount) ? s.minBillAmount : 0,
      payouts: t?.payouts ?? 0,
      bands: bandsOf(s, t),
    };
  };

  /** Whether this scheme gave something and counted this item's line. */
  const appliedOnItem = (s: PromoScheme, itemId: string): boolean => {
    const t = traceOf.get(s.id);
    const e = engIndexOfItem(itemId);
    return !!t && t.status === 'applied' && e >= 0 && t.counted.includes(e);
  };

  const keysOf = (itemId: string) => {
    const a = input.itemAttrs[itemId];
    return {
      itemId,
      groupId: a?.groupId ?? '',
      categoryId: a?.categoryId ?? '',
      brandId: a?.brandId ?? '',
      sectionId: a?.sectionId ?? '',
    };
  };

  return {
    lines,
    freeLines,
    schemeDiscPaise,
    billSchemeDiscPaise,
    freeQty: Number(freeLines.reduce((n, f) => n + f.qty, 0).toFixed(3)),
    appliedNames,
    notes: result.notes,
    priced,
    scheme: (id) => byId.get(id),

    badgesFor(itemIds) {
      const out: Record<string, ItemBadge[]> = {};
      for (const itemId of itemIds) {
        const badges: ItemBadge[] = [];
        const keys = keysOf(itemId);
        for (const s of schemes) {
          if (s.itemScope !== PromoCode.ScopeList) continue; // whole-order offers show in the banner
          if (gates.get(s.id) !== null) continue; // only offers that suit this shop, branch and day
          const reach = itemReach(s, keys);
          if (!reach.row) continue;
          const applied = appliedOnItem(s, itemId);
          const t = applied ? traceOf.get(s.id) : undefined;
          badges.push({ schemeId: s.id, code: s.code, name: s.name, benefit: s.benefit, applyOn: s.applyOn, applied, bands: bandsOf(s, t), payouts: t?.payouts ?? 0 });
        }
        out[itemId] = badges;
      }
      return out;
    },

    explain(itemId) {
      const offers: ItemOffer[] = [];
      const keys = keysOf(itemId);
      const e = engIndexOfItem(itemId);
      for (const s of schemes) {
        if (s.itemScope !== PromoCode.ScopeList) continue;
        const reach = itemReach(s, keys);
        if (!reach.row) continue;
        const t = traceOf.get(s.id);
        let reason: OfferReason;
        const gate = gates.get(s.id) ?? null;
        if (!input.applyOffers) reason = 'offersOff';
        else if (gate !== null) reason = gate;
        else if (e < 0) reason = 'notOnOrder';
        else if (!t) reason = 'notOnOrder';
        else {
          const skip = t.skipped.find((k) => k.index === e);
          if (skip) reason = SKIP_REASON[skip.why];
          else if (t.status === 'applied') reason = 'applied';
          else reason = t.status === 'notLive' || t.status === 'noLine' ? 'notOnOrder' : t.status;
        }
        const applied = reason === 'applied';
        const b = base(s, input.applyOffers && gate === null ? t : undefined, applied, reason);
        const lineQty = e >= 0 ? eng[e]!.netQty : 0;
        offers.push({
          ...b,
          countedItemIds: t && gate === null ? t.counted.map((k) => eng[k]!.itemId) : [],
          lineMinQtyShort: reach.row.minQty > lineQty ? round3(reach.row.minQty - lineQty) : 0,
        });
      }
      return offers;
    },

    orderOffers() {
      const offers: OrderOffer[] = [];
      for (const s of schemes) {
        if (s.itemScope === PromoCode.ScopeList) continue;
        const gate = gates.get(s.id) ?? null;
        if (gate !== null) continue; // only offers that suit this shop, branch and day
        const t = traceOf.get(s.id);
        const applied = !!t && t.status === 'applied';
        let reason: OfferReason;
        if (!input.applyOffers) reason = 'offersOff';
        else if (!t) reason = 'noLine';
        else reason = t.status === 'notLive' ? 'noLine' : t.status === 'applied' ? 'applied' : t.status;
        offers.push(base(s, input.applyOffers ? t : undefined, applied, reason));
      }
      return offers;
    },
  };
}

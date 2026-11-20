// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
//
// The matching rules of NexERP's promotion engine (promotion_rules.cpp), ported line for line:
// whether a scheme is live, whether the branch / shop / item qualify, which band covers a measure.
// Everything that decides WHETHER and HOW MUCH; scheme-engine.ts turns that into line outcomes.
import { num } from '../orders/order-math.ts';
import {
  PromoCode,
  type Flag,
  type LiveFail,
  type PromoBranchRow,
  type PromoDocContext,
  type PromoItemRow,
  type PromoLine,
  type PromoPartyRow,
  type PromoScheme,
  type PromoSlab,
  type SchemeInput,
  type SkipWhy,
} from './scheme-types.ts';

// ---------------------------------------------------------------------------------------------
// Parsing (PromoScheme::fromJson and friends)
// ---------------------------------------------------------------------------------------------

const flag = (f: Flag, dflt: boolean): boolean => (f === null || f === undefined ? dflt : f === true || f === 1);
const text = (s: string | null | undefined): string => s ?? '';
const intOf = (s: string | number | null | undefined): number => Math.trunc(typeof s === 'number' ? s : num(s ?? ''));

/** 'YYYY-MM-DD' (an ISO date-time is cut to its date); '' when it is not a date. */
export function dateOf(s: string | null | undefined): string {
  const d = text(s).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  const t = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return new Date(t).toISOString().slice(0, 10) === d ? d : '';
}

/** 'HH:MM:SS' or 'HH:MM' (whichever parses) as seconds since midnight; null when it does not. */
export function timeOf(s: string | null | undefined): number | null {
  const t = text(s);
  if (t === '') return null;
  const m = /^(\d{2}):(\d{2}):(\d{2})$/.exec(t.slice(0, 8)) ?? /^(\d{2}):(\d{2})$/.exec(t.slice(0, 5));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const sec = m[3] === undefined ? 0 : Number(m[3]);
  return h > 23 || mi > 59 || sec > 59 ? null : h * 3600 + mi * 60 + sec;
}

const scopeKey = (kind: string, scopeId: string): string => `${kind}|${scopeId}`;

/** One scheme row with its children into the parsed form, lookups built once. */
export function compileScheme(s: SchemeInput): PromoScheme {
  const slabs: PromoSlab[] = s.slabs.map((o) => {
    const each = num(o.prsEach);
    const hasFixedPrice = o.prsFixedPrice !== null && o.prsFixedPrice !== undefined;
    return {
      id: o.prsId,
      benefit: text(o.prsBenefit),
      exceeds: num(o.prsExceeds),
      // prs_upto NULL means open-ended, and 0 is a legal ceiling.
      hasUpto: o.prsUpto !== null && o.prsUpto !== undefined,
      upto: o.prsUpto !== null && o.prsUpto !== undefined ? num(o.prsUpto) : 0,
      each: each <= 0 ? 1 : each,
      isRepeat: flag(o.prsIsRepeat, false),
      maxRepeats: intOf(o.prsMaxRepeats),
      freeItemId: text(o.prsFreeItemId),
      freeUnitId: text(o.prsFreeUnitId),
      freeItemName: text(o.prsFreeItemName),
      freeUnitName: text(o.prsFreeUnitName),
      freeQty: num(o.prsFreeQty),
      freeStockCheck: flag(o.prsFreeStockCheck, true),
      discPerc: num(o.prsDiscPerc),
      discQty: num(o.prsDiscQty),
      discAmt: num(o.prsDiscAmt),
      hasFixedPrice,
      fixedPrice: hasFixedPrice ? num(o.prsFixedPrice) : 0,
      maxBenefitAmt: num(o.prsMaxBenefitAmt),
    };
  });
  const items: PromoItemRow[] = s.items.map((o) => {
    const factor = num(o.priFactor);
    return {
      id: o.priId,
      kind: o.priKind,
      scopeId: o.priScopeId,
      unitId: text(o.priUnitId),
      unitName: text(o.priUnitName),
      scopeName: text(o.priScopeName),
      isExclude: flag(o.priIsExclude, false),
      discPerc: num(o.priDiscPerc),
      discQty: num(o.priDiscQty),
      discAmt: num(o.priDiscAmt),
      minQty: num(o.priMinQty),
      factor: factor <= 0 ? 1 : factor, // ck_pri_values demands > 0
      maxBenefit: num(o.priMaxBenefit),
      matchPriority: intOf(o.priMatchPriority),
    };
  });
  const parties: PromoPartyRow[] = s.parties.map((o) => ({
    id: o.prpId,
    kind: o.prpKind,
    scopeId: o.prpScopeId,
    scopeName: text(o.prpScopeName),
    isExclude: flag(o.prpIsExclude, false),
    matchPriority: intOf(o.prpMatchPriority),
  }));
  const branches: PromoBranchRow[] = s.branches.map((o) => ({
    id: o.prbId,
    branchId: o.prbBranchId,
    branchName: text(o.prbBranchName),
    isExclude: flag(o.prbIsExclude, false),
  }));

  const validFrom = timeOf(s.prmValidFromTime);
  const validTo = timeOf(s.prmValidToTime);
  const itemIndex = new Map<string, number>();
  items.forEach((r, i) => itemIndex.set(scopeKey(r.kind, r.scopeId), i)); // a later duplicate wins, as QHash::insert
  const partyIndex = new Map<string, number>();
  parties.forEach((r, i) => partyIndex.set(scopeKey(r.kind, r.scopeId), i));
  const branchIndex = new Map<string, number>();
  branches.forEach((r, i) => branchIndex.set(r.branchId, i));

  return {
    id: s.prmId,
    code: s.prmCode,
    name: s.prmName,
    compId: s.prmCompId,
    branchId: text(s.prmBranchId),
    status: s.prmStatus,
    applyOn: s.prmApplyOn,
    benefit: s.prmBenefit,
    priority: intOf(s.prmPriority),
    stackMode: s.prmStackMode,
    autoApply: flag(s.prmAutoApply, true),
    allowWithManualDisc: flag(s.prmAllowWithManualDisc, false),
    calcOnAmountType: s.prmCalcOnAmountType,
    includeTax: flag(s.prmIncludeTax, false), // read and ignored, as in Qt
    billType: s.prmBillType,
    minBillAmount: num(s.prmMinBillAmount),
    minQty: num(s.prmMinQty),
    branchScope: s.prmBranchScope,
    custScope: s.prmCustScope,
    itemScope: s.prmItemScope,
    priceLevelId: intOf(s.prmPriceLevelId),
    maxBenefitPerBill: num(s.prmMaxBenefitPerBill),
    couponBatchId: text(s.prmCouponBatchId),
    startDate: dateOf(s.prmStartDate),
    endDate: dateOf(s.prmEndDate),
    validFrom,
    validTo,
    hasTimeWindow: validFrom !== null && validTo !== null,
    validWeekdays: text(s.prmValidWeekdays),
    isActive: true, // the phone only holds live, active rows; the server filtered the rest
    branches,
    parties,
    items,
    slabs,
    itemIndex,
    partyIndex,
    branchIndex,
  };
}

export const isExclusive = (s: PromoScheme): boolean => s.stackMode === PromoCode.Exclusive;
export const isBillLevel = (s: PromoScheme): boolean => s.applyOn.startsWith('BILL_');
export const measuresMoney = (s: PromoScheme): boolean => s.applyOn.endsWith('_AMOUNT');
export const usesBands = (s: PromoScheme): boolean => s.benefit !== PromoCode.DiscPerItem;
export const givesFreeItem = (s: PromoScheme): boolean => s.benefit === PromoCode.FreeItem;

/** Which figure a *_AMOUNT trigger measures on this line (PromoLine::moneyFor). */
export function moneyFor(l: PromoLine, calcOn: string): number {
  if (calcOn === PromoCode.GrossAmount) return l.gross;
  if (calcOn === PromoCode.TaxableAmount) return l.taxable;
  return l.netGross; // NET_AMOUNT, the default
}

/** Qt's qFuzzyIsNull for doubles. */
export const isNullish = (v: number): boolean => Math.abs(v) <= 0.000000000001;
export const isSet = (v: number): boolean => !isNullish(v);

// ---------------------------------------------------------------------------------------------
// Bands (PromoSlab::covers / payouts)
// ---------------------------------------------------------------------------------------------

export const covers = (b: PromoSlab, measure: number): boolean => measure >= b.exceeds && (!b.hasUpto || measure <= b.upto);

/**
 * How many times the band pays out for this measure. A non-repeating band pays once; a repeating
 * one per whole `each` above zero, capped by maxRepeats when that is set.
 */
export function payouts(b: PromoSlab, measure: number): number {
  if (!b.isRepeat) return 1;
  if (b.each <= 0) return 1;
  let times = Math.trunc(measure / b.each);
  if (times < 1) return 0;
  if (b.maxRepeats > 0 && times > b.maxRepeats) times = b.maxRepeats;
  return times;
}

/** The band covering this measure, highest `exceeds` first (the first of equals). Null when none does. */
export function slabFor(s: PromoScheme, measure: number): PromoSlab | null {
  let best: PromoSlab | null = null;
  for (const b of s.slabs) {
    if (!covers(b, measure)) continue;
    if (!best || b.exceeds > best.exceeds) best = b;
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Matchers (PromoMatch)
// ---------------------------------------------------------------------------------------------

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** "MON,TUE,..." contains the date's weekday (case-insensitive). Empty means every day. */
export function weekdayAllowed(csv: string, date: string): boolean {
  if (csv.trim() === '') return true;
  const d = dateOf(date);
  if (d === '') return true;
  const dow = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))).getUTCDay(); // 0 = Sunday
  const name = DAYS[(dow + 6) % 7]!;
  // Parts are not trimmed, as Qt: "MON, TUE" does not allow Tuesday.
  return csv
    .split(',')
    .filter((p) => p !== '')
    .some((p) => p.toUpperCase() === name);
}

/**
 * Whether the time of day is inside the scheme's window. A window whose end reads before its
 * start SPANS MIDNIGHT: 22:00-04:00 is a late-night offer. `at` is 'HH:MM:SS'; unreadable = allowed.
 */
export function timeAllowed(s: PromoScheme, at: string): boolean {
  const t = timeOf(at);
  if (!s.hasTimeWindow || t === null) return true;
  const from = s.validFrom!;
  const to = s.validTo!;
  if (from <= to) return t >= from && t <= to;
  return t >= from || t <= to;
}

/** The first document-level check a scheme fails, in the Qt order; null = live (schemeIsLive). */
export function liveFail(s: PromoScheme, ctx: PromoDocContext): LiveFail | null {
  if (s.status !== PromoCode.Approved || !s.isActive) return 'status';
  if (!s.autoApply) return 'autoApply';
  if (s.couponBatchId !== '') return 'coupon';
  if (s.compId !== ctx.compId) return 'company';
  if (s.branchId !== '' && ctx.branchId !== '' && s.branchId !== ctx.branchId) return 'headerBranch';
  const docDate = dateOf(ctx.docDate);
  if (docDate !== '') {
    if (s.startDate !== '' && docDate < s.startDate) return 'notStarted';
    if (s.endDate !== '' && docDate > s.endDate) return 'ended';
    if (!weekdayAllowed(s.validWeekdays, docDate)) return 'weekday';
  }
  if (!timeAllowed(s, ctx.docTime)) return 'time';
  if (s.billType !== PromoCode.BillAll && s.billType !== '' && s.billType !== ctx.billType) return 'billType';
  if (s.priceLevelId !== 0 && ctx.priceLevelId !== 0 && s.priceLevelId !== ctx.priceLevelId) return 'priceLevel';
  return null;
}

/** Status, active flag, auto-apply, coupon, company, header branch, date, weekday, time, bill type, price level. */
export const schemeIsLive = (s: PromoScheme, ctx: PromoDocContext): boolean => liveFail(s, ctx) === null;

/** Branch scope. EXCLUDE beats INCLUDE; there is no priority here. */
export function branchQualifies(s: PromoScheme, ctx: PromoDocContext): boolean {
  if (s.branchScope !== PromoCode.ScopeList) return true;
  const i = s.branchIndex.get(ctx.branchId);
  if (i === undefined) return false; // scoped to a LIST this branch is not on
  return !s.branches[i]!.isExclude;
}

/**
 * Customer scope. Highest match_priority wins; at equal priority an EXCLUDE beats an INCLUDE; a
 * scheme scoped to a LIST that no row reaches answers NO. CITY reaches a shop only through its area.
 */
export function customerQualifies(s: PromoScheme, ctx: PromoDocContext): boolean {
  if (s.custScope !== PromoCode.ScopeList) return true;
  const probes: [string, string][] = [
    [PromoCode.Customer, ctx.custId],
    [PromoCode.CustomerGroup, ctx.custGroupId],
    [PromoCode.Area, ctx.areaId],
    [PromoCode.City, ctx.cityId],
  ];
  let best: PromoPartyRow | null = null;
  for (const [kind, mine] of probes) {
    if (mine === '') continue;
    const i = s.partyIndex.get(scopeKey(kind, mine));
    if (i === undefined) continue;
    const r = s.parties[i]!;
    if (!best || r.matchPriority > best.matchPriority || (r.matchPriority === best.matchPriority && r.isExclude && !best.isExclude)) best = r;
  }
  return best !== null && !best.isExclude;
}

export interface ItemMatch {
  /** The winning item-scope row; null when the scope is ALL (everything qualifies, no per-row rate) or nothing matched. */
  row: PromoItemRow | null;
  qualifies: boolean;
  /** Why the line does not qualify; null when it does. */
  why: SkipWhy | null;
}

type ItemKeys = Pick<PromoLine, 'itemId' | 'groupId' | 'categoryId' | 'brandId' | 'sectionId'>;

const itemProbes = (l: ItemKeys): [string, string][] => [
  [PromoCode.Item, l.itemId],
  [PromoCode.ItemGroup, l.groupId],
  [PromoCode.ItemCategory, l.categoryId],
  [PromoCode.ItemBrand, l.brandId],
  [PromoCode.ItemSection, l.sectionId],
];

/**
 * Item scope for one line (itemRowFor). ALL: every line qualifies, no row. LIST: probe ITEM,
 * GROUP, CATEGORY, BRAND, SECTION; any EXCLUDE row found kills the line; an ITEM row whose unit
 * differs from the line's is skipped; the highest match_priority wins (the first of equals); the
 * line's qty must reach that row's pri_min_qty.
 */
export function itemRowFor(s: PromoScheme, line: PromoLine): ItemMatch {
  if (s.itemScope !== PromoCode.ScopeList) return { row: null, qualifies: true, why: null };

  let best: PromoItemRow | null = null;
  let unitSkipped = false;
  for (const [kind, mine] of itemProbes(line)) {
    if (mine === '') continue;
    const i = s.itemIndex.get(scopeKey(kind, mine));
    if (i === undefined) continue;
    const r = s.items[i]!;
    // An EXCLUDE row kills the line regardless of any broader rule.
    if (r.isExclude) return { row: null, qualifies: false, why: 'excluded' };
    // An ITEM row also has to agree on the unit: ten pieces, ten boxes and ten cases are three offers.
    if (r.kind === PromoCode.Item && r.unitId !== '' && line.unitId !== '' && r.unitId !== line.unitId) {
      unitSkipped = true;
      continue;
    }
    if (!best || r.matchPriority > best.matchPriority) best = r;
  }
  if (!best)
    return {
      row: null,
      qualifies: false,
      why: unitSkipped ? 'unit' : 'notListed',
    };
  if (line.netQty < best.minQty) return { row: null, qualifies: false, why: 'lineMinQty' };
  return { row: best, qualifies: true, why: null };
}

/**
 * Whether a LIST scheme names an item at all, ignoring unit and minimum quantity (for badges):
 * the best include row, or `excluded` when any exclude row reaches it. Not in the Qt code.
 */
export function itemReach(s: PromoScheme, keys: ItemKeys): { row: PromoItemRow | null; excluded: boolean } {
  let best: PromoItemRow | null = null;
  for (const [kind, mine] of itemProbes(keys)) {
    if (mine === '') continue;
    const i = s.itemIndex.get(scopeKey(kind, mine));
    if (i === undefined) continue;
    const r = s.items[i]!;
    if (r.isExclude) return { row: null, excluded: true };
    if (!best || r.matchPriority > best.matchPriority) best = r;
  }
  return { row: best, excluded: false };
}

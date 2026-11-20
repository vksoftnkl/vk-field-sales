// Words for the offer screens: badges, bands, "why not". No React (only a translate function), so
// the Add items rows, the Offer details sheet, Order item and Review all say the same thing.
import type { TFunction } from 'i18next';

import { qtyText, toPaise } from '@/features/orders/order-math';
import { formatDay, type DateNames } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';

import { measuresMoney } from './scheme-rules';
import type { ItemOffer, OfferReason, OrderOffer } from './scheme-order';
import { PromoCode, type PromoScheme, type PromoSlab } from './scheme-types';

type Offer = ItemOffer | OrderOffer;

/** ₹5, ₹5.50, ₹1,000 (no .00). */
export const rupees = (n: number): string => formatAmount(Math.round(n * 100)).replace(/\.00$/, '');

/** The unit an offer names: its first ITEM row's unit ('' when none). */
export const schemeUnit = (s: PromoScheme): string => s.items.find((r) => r.kind === PromoCode.Item && r.unitName !== '')?.unitName ?? '';

/** A measure in the offer's own terms: ₹ for an amount offer, quantity + unit otherwise. */
export const measureText = (s: PromoScheme, n: number, unit: string): string => (measuresMoney(s) ? rupees(n) : `${qtyText(n)}${unit ? ` ${unit}` : ''}`);

/** What a band gives: "3% off", "2 PCS Glucose Biscuit free", "₹5 off per PKT", "₹100 off", "price ₹80". */
export function bandGives(s: PromoScheme, b: PromoSlab, unit: string, t: TFunction): string {
  switch (s.benefit) {
    case PromoCode.FreeItem:
      return t('offers.gives.free', { qty: qtyText(b.freeQty), unit: b.freeUnitName, name: b.freeItemName })
        .replace(/\s+/g, ' ')
        .trim();
    case PromoCode.DiscPerc:
      return t('offers.gives.perc', { perc: String(Number(b.discPerc.toFixed(4))) });
    case PromoCode.DiscAmt:
      return b.discQty > 0 ? t('offers.gives.perUnit', { amount: rupees(b.discQty), unit: unit || t('offers.unitWord') }) : t('offers.gives.amount', { amount: rupees(b.discAmt) });
    case PromoCode.FixedPrice:
      return t('offers.gives.fixed', { price: rupees(b.fixedPrice) });
    default:
      return t('offers.gives.itemRates');
  }
}

/** A band's reward in a few characters, for the band boxes: "3%", "2 free", "₹5 / PKT", "₹100 off", "₹80". */
export function bandShort(s: PromoScheme, b: PromoSlab, unit: string, t: TFunction): string {
  switch (s.benefit) {
    case PromoCode.FreeItem:
      return t('offers.short.free', { qty: qtyText(b.freeQty) });
    case PromoCode.DiscPerc:
      return t('offers.short.perc', { perc: String(Number(b.discPerc.toFixed(4))) });
    case PromoCode.DiscAmt:
      return b.discQty > 0 ? t('offers.short.perUnit', { amount: rupees(b.discQty), unit: unit || t('offers.unitWord') }) : t('offers.gives.amount', { amount: rupees(b.discAmt) });
    case PromoCode.FixedPrice:
      return rupees(b.fixedPrice);
    default:
      return t('offers.gives.itemRates');
  }
}

/** A band's range: "6–11 PKT", "24+ PKT", "₹10,000+". */
export function bandRange(s: PromoScheme, b: PromoSlab, unit: string, t: TFunction): string {
  const u = !measuresMoney(s) && unit ? ` ${unit}` : '';
  const f = (n: number) => (measuresMoney(s) ? rupees(n) : qtyText(n));
  return b.hasUpto ? t('offers.range', { from: f(b.exceeds), to: f(b.upto), unit: u }) : t('offers.rangeOpen', { from: f(b.exceeds), unit: u });
}

/** A band box's range: "Every 10 PCS" for a repeating band, else bandRange's. */
export function bandBoxRange(s: PromoScheme, b: PromoSlab, unit: string, t: TFunction): string {
  return b.isRepeat && b.each > 0 ? t('offers.rangeEvery', { each: measureText(s, b.each, unit) }) : bandRange(s, b, unit, t);
}

/** The icon of an offer: a gift for free goods, a price tag for money off. */
export const offerIcon = (s: PromoScheme): 'gift-outline' | 'pricetag-outline' => (s.benefit === PromoCode.FreeItem ? 'gift-outline' : 'pricetag-outline');

const joinNames = (names: string[], t: TFunction): string => {
  const uniq = [...new Set(names.filter(Boolean))];
  return uniq.length <= 2 ? uniq.join(', ') : t('offers.andMore', { names: uniq.slice(0, 2).join(', '), count: uniq.length - 2 });
};

/** What the offer counts, by name ("Glucose Biscuit 75 g", "Annam Spices"); '' when it counts every item. */
export function coversText(s: PromoScheme, t: TFunction): string {
  if (s.itemScope !== PromoCode.ScopeList) return '';
  return joinNames(
    s.items.filter((r) => !r.isExclude).map((r) => r.scopeName),
    t,
  );
}

/** The group, brand, category or section an offer counts together ("Annam Spices"); '' for an item list. */
export function groupText(s: PromoScheme, t: TFunction): string {
  if (s.itemScope !== PromoCode.ScopeList) return '';
  return joinNames(
    s.items.filter((r) => !r.isExclude && r.kind !== PromoCode.Item).map((r) => r.scopeName),
    t,
  );
}

/** The chip on an offer: "Applied 3%", "Applied · 2 free", "Applied", "Not applied". */
export function chipText(s: PromoScheme, offer: Offer, t: TFunction): string {
  if (!offer.applied) return t('offers.card.notApplied');
  const cur = s.slabs.find((x) => offer.bands.find((y) => y.current)?.exceeds === x.exceeds);
  if (cur && s.benefit === PromoCode.DiscPerc) return t('offers.card.appliedPerc', { perc: String(Number(cur.discPerc.toFixed(4))) });
  if (cur && s.benefit === PromoCode.FreeItem && offer.payouts > 0) return t('offers.card.appliedFree', { qty: qtyText(cur.freeQty * offer.payouts) });
  return t('offers.card.applied');
}

/**
 * What one band gives, as a sentence: "Every 10 PCS of Glucose Biscuit 75 g → 1 PCS Glucose
 * Biscuit 75 g free", "From ₹10,000 → ₹100 off".
 */
export function giveText(s: PromoScheme, b: PromoSlab, unit: string, t: TFunction): string {
  const u = unit || schemeUnit(s);
  const what = coversText(s, t);
  const repeat = b.isRepeat && b.each > 0;
  const at = measureText(s, repeat ? b.each : b.exceeds, u);
  const gives = bandGives(s, b, u, t);
  const key = repeat ? 'every' : 'from';
  return what ? t(`offers.give.${key}Of`, { at, what, gives }) : t(`offers.give.${key}`, { at, gives });
}

/** "Again for every 10 more · no limit per order" under a repeating band; '' otherwise. */
export function repeatText(s: PromoScheme, unit: string, t: TFunction): string {
  const r = s.slabs.find((b) => b.isRepeat);
  if (!r) return '';
  const u = unit || schemeUnit(s);
  return [t('offers.sheet.again', { each: measureText(s, r.each, u) }), r.maxRepeats > 0 ? t('offers.sheet.limit', { count: r.maxRepeats }) : t('offers.sheet.noLimit')].join(' · ');
}

/** "24 PCS → 2 PCS Glucose Biscuit 75 g free": what the band in force gives for what was counted; '' when none. */
export function onOrderText(s: PromoScheme, offer: Offer, unit: string, t: TFunction): string {
  if (!offer.applied) return '';
  const cur = s.slabs.find((b) => offer.bands.find((x) => x.current)?.exceeds === b.exceeds);
  if (!cur) return '';
  const u = unit || schemeUnit(s);
  return `${measureText(s, offer.measure, u)} → ${bandGives(s, { ...cur, freeQty: cur.freeQty * Math.max(1, offer.payouts) }, u, t)}`;
}

/** The band a badge speaks of: the one in force, else the first. */
function badgeBand(s: PromoScheme, offer: { bands: { exceeds: number; current: boolean }[] }): PromoSlab | undefined {
  const cur = offer.bands.find((x) => x.current);
  const exceeds = cur ? cur.exceeds : Math.min(...s.slabs.map((x) => x.exceeds));
  return s.slabs.find((x) => x.exceeds === exceeds);
}

/** The badge on an Add items row: "Buy 10 get 1 · 2 free", "₹5 off per PKT from 12 PKT", "Spice slab 3% off". */
export function badgeText(s: PromoScheme, offer: { applied: boolean; bands: { exceeds: number; current: boolean }[]; payouts: number }, unit: string, t: TFunction): string {
  const b = badgeBand(s, offer);
  if (!b || s.benefit === PromoCode.DiscPerItem) return s.name;
  const u = unit || schemeUnit(s);
  const from = measureText(s, b.exceeds, u);
  switch (s.benefit) {
    case PromoCode.FreeItem: {
      const each = b.isRepeat ? b.each : b.exceeds;
      const base = t('offers.badge.free', { each: qtyText(each), free: qtyText(b.freeQty) });
      return offer.applied && offer.payouts > 0 ? `${base} · ${t('offers.badge.freeNow', { qty: qtyText(b.freeQty * offer.payouts) })}` : base;
    }
    case PromoCode.DiscPerc:
      return t('offers.badge.perc', { name: s.name, perc: String(Number(b.discPerc.toFixed(4))) });
    case PromoCode.DiscAmt:
      return b.discQty > 0
        ? t('offers.badge.perUnit', { amount: rupees(b.discQty), unit: u || t('offers.unitWord'), from })
        : t('offers.badge.amount', { amount: rupees(b.discAmt), from });
    case PromoCode.FixedPrice:
      return t('offers.badge.fixed', { price: rupees(b.fixedPrice), from });
    default:
      return s.name;
  }
}

/** 'MON,TUE' -> 'Mon, Tue' in the app's language. */
export function weekdaysText(csv: string, weekdaysShort: readonly string[]): string {
  const order = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  return csv
    .split(',')
    .filter((p) => p !== '')
    .map((p) => weekdaysShort[order.indexOf(p.trim().toUpperCase())] ?? p)
    .join(', ');
}

const hhmm = (sec: number): string => `${String(Math.floor(sec / 3600)).padStart(2, '0')}:${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}`;

/** "Only on Mon, Tue" / "Between 09:00 and 17:00" for the sheet; '' when the offer has none. */
export const daysText = (s: PromoScheme, weekdaysShort: readonly string[], t: TFunction): string =>
  s.validWeekdays.trim() ? t('offers.days', { days: weekdaysText(s.validWeekdays, weekdaysShort) }) : '';
export const hoursText = (s: PromoScheme, t: TFunction): string => (s.hasTimeWindow ? t('offers.hours', { from: hhmm(s.validFrom!), to: hhmm(s.validTo!) }) : '');

/** Who the offer is for: "All shops", "Only Retail (group)", "Not Cash shops (group)". */
export function shopsText(s: PromoScheme, t: TFunction): string {
  if (s.custScope !== PromoCode.ScopeList) return t('offers.allShops');
  const label = (kind: string) => t(`offers.kind.${kind}`, { defaultValue: '' });
  const named = (r: { kind: string; scopeName: string; scopeId: string }) => `${r.scopeName || r.scopeId}${label(r.kind) ? ` (${label(r.kind)})` : ''}`;
  const inc = s.parties.filter((r) => !r.isExclude).map(named);
  const exc = s.parties.filter((r) => r.isExclude).map(named);
  return [inc.length ? t('offers.only', { list: inc.join(', ') }) : '', exc.length ? t('offers.not', { list: exc.join(', ') }) : ''].filter(Boolean).join(' · ');
}

/** Which branches: "All branches", "Only Chennai, Madurai", "This branch only". */
export function branchesText(s: PromoScheme, t: TFunction): string {
  if (s.branchScope !== PromoCode.ScopeList) return s.branchId ? t('offers.oneBranch') : t('offers.allBranches');
  const name = (r: { branchName: string; branchId: string }) => r.branchName || r.branchId;
  const inc = s.branches.filter((r) => !r.isExclude).map(name);
  const exc = s.branches.filter((r) => r.isExclude).map(name);
  return [inc.length ? t('offers.only', { list: inc.join(', ') }) : '', exc.length ? t('offers.not', { list: exc.join(', ') }) : ''].filter(Boolean).join(' · ');
}

/** Why an offer is not applied, in words (or 'Applied'). */
export function reasonText(
  reason: OfferReason,
  s: PromoScheme,
  offer: Offer & { lineMinQtyShort?: number },
  unit: string,
  names: DateNames & { weekdaysShort: readonly string[] },
  t: TFunction,
): string {
  const u = unit || schemeUnit(s);
  switch (reason) {
    case 'notStarted':
      return t('offers.reason.notStarted', { date: formatDay(s.startDate, names) });
    case 'ended':
      return t('offers.reason.ended', { date: formatDay(s.endDate, names) });
    case 'weekday':
      return t('offers.reason.weekday', { days: weekdaysText(s.validWeekdays, names.weekdaysShort) });
    case 'time':
      return t('offers.reason.time', { from: hhmm(s.validFrom ?? 0), to: hhmm(s.validTo ?? 0) });
    case 'customer':
      return t('offers.reason.customer', { who: shopsText(s, t) });
    case 'billType':
      return t('offers.reason.billType', { type: s.billType.toLowerCase() });
    case 'priceLevel':
      return t('offers.reason.priceLevel', { level: s.priceLevelId });
    case 'unit':
      return t('offers.reason.unit', { unit: u || t('offers.unitWord') });
    case 'lineMinQty':
      return t('offers.reason.lineMinQty', { qty: qtyText(offer.lineMinQtyShort ?? 0), unit: u });
    case 'minQty':
      return t('offers.reason.minQty', { qty: qtyText(offer.minQtyShort), unit: u });
    case 'minAmount':
      return t('offers.reason.minAmount', { amount: rupees(offer.minBillShort) });
    case 'noBand':
    case 'noPayout':
      return offer.nextBand ? t('offers.reason.moreReaches', { more: measureText(s, offer.nextBand.more, u) }) : t('offers.reason.notReached');
    case 'status':
    case 'autoApply':
    case 'coupon':
    case 'company':
    case 'headerBranch':
      return t('offers.reason.notAvailable');
    default:
      return t(`offers.reason.${reason}`);
  }
}

/**
 * "6 more PKT of Annam Spices → 5% off" (a group counted together), "6 more PCS → 3 PCS … free",
 * "₹4,696 more → ₹100 off" for the next band or repeat, or '' when none.
 */
export function nudgeText(s: PromoScheme, offer: Offer, unit: string, t: TFunction): string {
  const u = unit || schemeUnit(s);
  const say = (more: number, gives: string): string => {
    if (measuresMoney(s)) return t('offers.nudge', { more: rupees(more), gives });
    const what = groupText(s, t);
    return t(what ? 'offers.nudgeQtyOf' : 'offers.nudgeQty', { n: qtyText(more), unit: u, what, gives }).replace(/\s+/g, ' ');
  };
  if (offer.nextRepeat && offer.applied) {
    const b = s.slabs.find((x) => offer.bands.find((y) => y.current)?.exceeds === x.exceeds);
    if (b) return say(offer.nextRepeat.more, bandGives(s, { ...b, freeQty: b.freeQty * (offer.payouts + 1) }, u, t));
  }
  if (!offer.nextBand) return '';
  const next = s.slabs.find((x) => x.exceeds === offer.nextBand!.at);
  if (!next) return '';
  return say(offer.nextBand.more, bandGives(s, next, u, t));
}

/** ₹ text of a paise amount, for lines: 2484 -> '₹24.84'. */
export const paiseAmount = (p: number): string => formatAmount(p);
export const textPaise = (s: string | null): number => toPaise(s) ?? 0;

/** Offers that are not for today, this day, time, bill or the office's own state are not shown at all (a shop or branch miss is). */
const HIDDEN: ReadonlySet<OfferReason> = new Set<OfferReason>([
  'status',
  'autoApply',
  'coupon',
  'company',
  'headerBranch',
  'notStarted',
  'ended',
  'weekday',
  'time',
  'billType',
  'priceLevel',
]);
export const isShownOffer = (o: { reason: OfferReason }): boolean => !HIDDEN.has(o.reason);

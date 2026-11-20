// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
//
// NexERP's promotion engine (promotion_engine.cpp) ported with its behaviour and quirks: lines in,
// outcomes out. It decides what every scheme gives and writes nothing anywhere; scheme-order.ts
// reads an order into PromoLine and writes the result back, as the desktop's binder does.
//
// What it writes, and why in that form (as the Qt comment): a RATE wherever the scheme has one, so
// the line shows "10% off"; a flat item amount straight to schAmt; a flat BILL-level amount as one
// percentage of the qualifying base; a capped benefit as an amount.
//
// Added on top of the Qt behaviour, changing none of it: a `trace` per scheme saying what happened
// (applied, or the check that stopped it, and why each line was not counted). explain() reads it.
import {
  PromoCode,
  type PromoDocContext,
  type PromoFreeLine,
  type PromoItemRow,
  type PromoLine,
  type PromoLineOutcome,
  type PromoResult,
  type PromoScheme,
  type PromoSlab,
  type SchemeInput,
  type SchemeTrace,
  type SkipWhy,
} from './scheme-types.ts';
import {
  branchQualifies,
  compileScheme,
  customerQualifies,
  isBillLevel,
  isExclusive,
  isSet,
  itemRowFor,
  liveFail,
  measuresMoney,
  moneyFor,
  payouts,
  slabFor,
} from './scheme-rules.ts';

/**
 * Parse the phone's scheme rows and sort them for the engine: lowest prm_priority first, ties in
 * arrival order (the cache's stable_sort, promotion_scheme_cache.cpp sortByPriority).
 */
export function compileSchemes(inputs: readonly SchemeInput[]): PromoScheme[] {
  const list = inputs.map(compileScheme);
  // Array.prototype.sort is stable.
  return list.sort((a, b) => a.priority - b.priority);
}

/** What a line has already been given, in money, by an earlier scheme this pass. */
function givenOn(o: PromoLineOutcome, l: PromoLine, calcOn: string): number {
  if (isSet(o.schPerc)) return (moneyFor(l, calcOn) * o.schPerc) / 100;
  if (isSet(o.schPerQty)) return l.netQty * o.schPerQty;
  return o.schAmt;
}

/**
 * Land `money` on a line as a RATE where the line is still free and the scheme has one, and as a
 * plain amount once it has to share: two stackable schemes on one line fold into one amount.
 */
function landMoney(out: PromoLineOutcome, l: PromoLine, calcOn: string, money: number, asPerc: number, asPerQty: number): void {
  const already = givenOn(out, l, calcOn);
  if (isSet(already)) {
    out.schPerc = 0;
    out.schPerQty = 0;
    out.schAmt = already + money;
    return;
  }
  if (isSet(asPerc)) out.schPerc = asPerc;
  else if (isSet(asPerQty)) out.schPerQty = asPerQty;
  else out.schAmt = money;
}

/** The id keeps the FIRST claimant; the name accumulates, joined by " + " (a name already in it is not added again). */
function attribute(out: PromoLineOutcome, s: PromoScheme): void {
  if (out.schemeId === '') out.schemeId = s.id;
  if (out.schemeName === '') out.schemeName = s.name;
  else if (!out.schemeName.includes(s.name)) out.schemeName += ` + ${s.name}`;
}

function emptyOutcome(row: number): PromoLineOutcome {
  return {
    row,
    schPerc: 0,
    schPerQty: 0,
    schAmt: 0,
    billSchPerc: 0,
    fixedPrice: 0,
    hasFixedPrice: false,
    schemeId: '',
    schemeName: '',
  };
}

/** Decide, for the lines of a document, against a compiled scheme list (sorted by priority). */
export function evaluate(lines: readonly PromoLine[], ctx: PromoDocContext, schemes: readonly PromoScheme[]): PromoResult {
  const result: PromoResult = {
    lines: lines.map((l) => emptyOutcome(l.row)),
    freeLines: [],
    notes: [],
    totalBenefit: 0,
    traces: [],
  };

  if (!ctx.promotionsEnabled) return result; // the document's own switch is off

  // Lines an EXCLUSIVE scheme has already claimed: nothing weaker may touch them again.
  const claimed = new Set<number>();

  for (const s of schemes) {
    const trace: SchemeTrace = {
      schemeId: s.id,
      status: 'notLive',
      liveFail: null,
      money: 0,
      qty: 0,
      measure: 0,
      counted: [],
      skipped: [],
      band: null,
      payouts: 0,
      benefit: 0,
    };
    result.traces.push(trace);

    trace.liveFail = liveFail(s, ctx);
    if (trace.liveFail !== null) continue;
    if (!branchQualifies(s, ctx)) {
      trace.status = 'branch';
      continue;
    }
    if (!customerQualifies(s, ctx)) {
      trace.status = 'customer';
      continue;
    }

    // Which lines does this scheme see?
    const idx: number[] = [];
    const rows: (PromoItemRow | null)[] = [];
    let money = 0;
    let qty = 0;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (!l.schemeFlag || l.isFree) {
        if (!l.isFree) trace.skipped.push({ index: i, why: 'flagOff' });
        continue; // the line's own opt-out, and never a giveaway
      }
      if (claimed.has(i)) {
        trace.skipped.push({ index: i, why: 'claimed' });
        continue;
      }
      // The head-office lever against margin being given away twice at the counter.
      if (!s.allowWithManualDisc && l.hasManualDisc) {
        trace.skipped.push({ index: i, why: 'manualDisc' });
        continue;
      }
      const m = itemRowFor(s, l);
      if (!m.qualifies) {
        trace.skipped.push({ index: i, why: m.why as SkipWhy });
        continue;
      }
      idx.push(i);
      rows.push(m.row);
      money += moneyFor(l, s.calcOnAmountType);
      qty += l.netQty;
    }
    trace.counted = idx;
    trace.money = money;
    trace.qty = qty;
    trace.measure = measuresMoney(s) ? money : qty;
    if (idx.length === 0) {
      // Worth saying out loud: the usual cause is an ITEM row whose unit differs from the line's.
      result.notes.push(`${s.code}: matched no line on this document`);
      trace.status = 'noLine';
      continue;
    }

    // Thresholds, each against its own unit.
    if (isSet(s.minQty) && qty < s.minQty) {
      trace.status = 'minQty';
      continue;
    }
    if (isSet(s.minBillAmount) && money < s.minBillAmount) {
      trace.status = 'minAmount';
      continue;
    }

    // The measure is RUPEES for a *_AMOUNT trigger and QUANTITY for a *_QTY one.
    const measure = trace.measure;

    // DISC_PER_ITEM: no band at all, the item row IS the offer.
    if (s.benefit === PromoCode.DiscPerItem) {
      let gave = false;
      for (let n = 0; n < idx.length; n++) {
        const row = rows[n]!;
        if (!row || !(isSet(row.discPerc) || isSet(row.discQty) || isSet(row.discAmt))) continue; // scope-only row: nothing to give
        const i = idx[n]!;
        const out = result.lines[i]!;
        const l = lines[i]!;
        // pri_factor is meaningless here: there is no band to scale.
        let m = row.discAmt;
        if (isSet(row.discPerc)) m = (moneyFor(l, s.calcOnAmountType) * row.discPerc) / 100;
        else if (isSet(row.discQty)) m = l.netQty * row.discQty;
        landMoney(out, l, s.calcOnAmountType, m, row.discPerc, row.discQty);
        result.totalBenefit += m;
        trace.benefit += m;
        attribute(out, s);
        gave = true;
        if (isExclusive(s)) claimed.add(i);
      }
      if (!gave) {
        result.notes.push(`${s.code}: no item row carries a rate`);
        trace.status = 'noRate';
      } else trace.status = 'applied';
      continue;
    }

    // Everything else is banded.
    const band: PromoSlab | null = slabFor(s, measure);
    if (!band) {
      trace.status = 'noBand'; // measured, but into no band
      continue;
    }
    trace.band = band;
    const times = payouts(band, measure);
    trace.payouts = times;
    if (times < 1) {
      trace.status = 'noPayout';
      continue;
    }

    // FREE_ITEM: a new line, not a discount.
    if (s.benefit === PromoCode.FreeItem) {
      const freeQty = band.freeQty * times;
      if (!isSet(freeQty) || band.freeItemId === '') {
        trace.status = 'noFreeItem';
        continue;
      }
      const f: PromoFreeLine = {
        itemId: band.freeItemId,
        unitId: band.freeUnitId,
        itemName: band.freeItemName,
        unitName: band.freeUnitName,
        qty: freeQty,
        schemeId: s.id,
        schemeName: s.name,
        stockCheck: band.freeStockCheck,
        // Below the last line that earned it; a bill-level trigger has no single cause: append.
        afterRow: isBillLevel(s) ? -1 : lines[idx[idx.length - 1]!]!.row,
      };
      result.freeLines.push(f);
      trace.status = 'applied';
      // Deliberately NOT attributing the trigger lines: the giveaway row carries the scheme id and name.
      if (isExclusive(s)) for (const i of idx) claimed.add(i);
      continue;
    }

    // The money benefits: work out RUPEES first, cap, and only then choose how to express it.
    let benefit = 0;
    if (s.benefit === PromoCode.DiscPerc) {
      benefit = (money * band.discPerc) / 100;
    } else if (s.benefit === PromoCode.DiscAmt) {
      // ck_prs_benefit_columns makes these an XOR: rupees per unit, or a flat amount.
      benefit = isSet(band.discQty) ? band.discQty * qty : band.discAmt * times;
    } else if (s.benefit === PromoCode.FixedPrice) {
      for (const i of idx) {
        const l = lines[i]!;
        const drop = (l.rate - band.fixedPrice) * l.netQty;
        if (drop > 0) benefit += drop;
      }
    }
    if (benefit <= 0) {
      if (s.benefit === PromoCode.FixedPrice) {
        // A FIXED_PRICE scheme may only ever bring a price DOWN.
        result.notes.push(`${s.code}: every matching line already sells at or below ${band.fixedPrice}`);
      }
      trace.status = 'noBenefit';
      continue;
    }

    let capped = false;
    const capTo = (ceiling: number): void => {
      if (isSet(ceiling) && benefit > ceiling) {
        benefit = ceiling;
        capped = true;
      }
    };
    capTo(band.maxBenefitAmt); // per band
    capTo(s.maxBenefitPerBill); // per document
    // What is left of the document cap after earlier schemes. A remainder of exactly 0 is "not
    // set", so no cap applies then (kept from Qt: capTo(0) is a no-op).
    if (isSet(result.totalBenefit) && isSet(s.maxBenefitPerBill)) capTo(Math.max(0, s.maxBenefitPerBill - result.totalBenefit));

    if (isBillLevel(s)) {
      // One percentage of the qualifying base, spread across every qualifying line.
      if (money <= 0) {
        trace.status = 'noBenefit';
        continue;
      }
      const perc = (benefit / money) * 100;
      for (const i of idx) {
        const out = result.lines[i]!;
        out.billSchPerc += perc; // two bill schemes add up
        attribute(out, s);
        if (isExclusive(s)) claimed.add(i);
      }
    } else {
      for (let n = 0; n < idx.length; n++) {
        const i = idx[n]!;
        const l = lines[i]!;
        const row = rows[n]!;
        // pri_factor scales whatever the band computed for this line.
        const factor = row ? row.factor : 1;
        const out = result.lines[i]!;

        // This line's share of the money, pro-rata on its own measure.
        const share = measuresMoney(s) ? (money > 0 ? moneyFor(l, s.calcOnAmountType) / money : 0) : qty > 0 ? l.netQty / qty : 0;
        const lineMoney = benefit * share * factor;

        // A rate is only offered where the scheme has one AND no cap interfered.
        const ratePerc = s.benefit === PromoCode.DiscPerc && !capped;
        const rateQty = s.benefit === PromoCode.DiscAmt && isSet(band.discQty) && !capped;
        landMoney(out, l, s.calcOnAmountType, lineMoney, ratePerc ? band.discPerc * factor : 0, rateQty ? band.discQty * factor : 0);

        if (s.benefit === PromoCode.FixedPrice) {
          out.hasFixedPrice = true;
          out.fixedPrice = band.fixedPrice;
        }

        // pri_max_benefit caps this one line, whatever the band said.
        if (row && isSet(row.maxBenefit)) {
          const lineBase = moneyFor(l, s.calcOnAmountType);
          let given = out.schAmt;
          if (isSet(out.schPerc)) given = (lineBase * out.schPerc) / 100;
          if (isSet(out.schPerQty)) given = l.netQty * out.schPerQty;
          if (given > row.maxBenefit) {
            out.schPerc = 0;
            out.schPerQty = 0;
            out.schAmt = row.maxBenefit;
          }
        }

        attribute(out, s);
        if (isExclusive(s)) claimed.add(i);
      }
    }

    result.totalBenefit += benefit;
    trace.benefit = benefit;
    trace.status = 'applied';
  }

  return result;
}

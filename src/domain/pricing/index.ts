/**
 * GST pricing engine — pure TypeScript, no React Native imports.
 *
 * Kept dependency-free on purpose so it can move into a shared package
 * (e.g. packages/pricing) used by the NestJS server and the Next.js web app too.
 * The phone uses it to SHOW totals; VK Nex recalculates and is the source of truth.
 *
 * Units: money in integer paise, rates in basis points (18% = 1800), qty as a decimal.
 */

export interface LineInput {
  qty: number;
  ratePaise: number;
  /** Line discount in basis points (5% = 500). */
  discBp?: number;
  gstRateBp: number;
  cessRateBp?: number;
  /** true when ratePaise already includes GST + cess (MRP-style pricing). */
  taxInclusive?: boolean;
}

export interface LineResult {
  grossPaise: number;
  discPaise: number;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  totalPaise: number;
}

export interface BillResult {
  lines: LineResult[];
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  taxPaise: number;
  /** Signed adjustment to reach the nearest rupee. */
  roundOffPaise: number;
  totalPaise: number;
}

const BP = 10_000;
const round = (n: number) => Math.round(n);

/** Inter-state supply → IGST; same state → CGST + SGST. */
export function isInterState(sellerStateCode: string | null | undefined, buyerStateCode: string | null | undefined): boolean {
  if (!sellerStateCode || !buyerStateCode) return false; // unknown buyer state → treat as local (B2C)
  return sellerStateCode.trim() !== buyerStateCode.trim();
}

export function computeLine(input: LineInput, interState: boolean): LineResult {
  const { qty, ratePaise, discBp = 0, gstRateBp, cessRateBp = 0, taxInclusive = false } = input;
  if (!(qty > 0)) throw new RangeError('qty must be > 0');
  if (ratePaise < 0) throw new RangeError('rate must be >= 0');

  const grossPaise = round(qty * ratePaise);
  const discPaise = round((grossPaise * discBp) / BP);
  const net = grossPaise - discPaise;

  let taxablePaise: number;
  let gstPaise: number;
  let cessPaise: number;

  if (taxInclusive) {
    taxablePaise = round((net * BP) / (BP + gstRateBp + cessRateBp));
    cessPaise = round((taxablePaise * cessRateBp) / BP);
    gstPaise = net - taxablePaise - cessPaise; // remainder keeps total == net exactly
  } else {
    taxablePaise = net;
    cessPaise = round((taxablePaise * cessRateBp) / BP);
    gstPaise = interState
      ? round((taxablePaise * gstRateBp) / BP)
      : 2 * round((taxablePaise * gstRateBp) / 2 / BP); // CGST and SGST are rounded separately
  }

  let cgstPaise = 0;
  let sgstPaise = 0;
  let igstPaise = 0;
  if (interState) {
    igstPaise = gstPaise;
  } else {
    cgstPaise = round(gstPaise / 2);
    sgstPaise = gstPaise - cgstPaise;
  }

  return {
    grossPaise,
    discPaise,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    cessPaise,
    totalPaise: taxablePaise + gstPaise + cessPaise,
  };
}

export function computeBill(lines: LineInput[], interState: boolean): BillResult {
  const results = lines.map((l) => computeLine(l, interState));
  const sum = (k: keyof LineResult) => results.reduce((acc, r) => acc + r[k], 0);

  const taxablePaise = sum('taxablePaise');
  const cgstPaise = sum('cgstPaise');
  const sgstPaise = sum('sgstPaise');
  const igstPaise = sum('igstPaise');
  const cessPaise = sum('cessPaise');
  const taxPaise = cgstPaise + sgstPaise + igstPaise + cessPaise;
  const exact = taxablePaise + taxPaise;
  const totalPaise = round(exact / 100) * 100;

  return {
    lines: results,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    cessPaise,
    taxPaise,
    roundOffPaise: totalPaise - exact,
    totalPaise,
  };
}

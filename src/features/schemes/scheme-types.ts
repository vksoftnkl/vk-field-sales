// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
//
// The promotion engine's data types, ported from NexERP's promotion_rules.h / promotion_engine.h
// (camelCase). Two families:
//  - `Scheme*Input`: what the phone's SQLite tables hold (plan §5.2, columns camelCased: prm_id ->
//    prmId, prb_branch_id -> prbBranchId ...). Money and quantities stay text, as SQLite stores
//    them; scheme-rules.ts parses them. The loader (scheme-load.ts) fills these from rows.
//  - `Promo*`: the parsed form the rules and the engine read (numbers, lookups built once).

/** A SQLite integer-mode boolean can arrive as boolean or 0/1. */
export type Flag = boolean | number | null | undefined;

// ---------------------------------------------------------------------------------------------
// Input: the five phone tables, one row each (plan §5.2)
// ---------------------------------------------------------------------------------------------

/** promotion_scheme_branch */
export interface SchemeBranchInput {
  prbId: string;
  prbBranchId: string;
  prbBranchName?: string | null;
  prbIsExclude: Flag;
}

/** promotion_scheme_party; prpKind CUSTOMER | CUSTOMER_GROUP | AREA | CITY */
export interface SchemePartyInput {
  prpId: string;
  prpKind: string;
  prpScopeId: string;
  prpScopeName?: string | null;
  prpIsExclude: Flag;
  prpMatchPriority: number;
}

/** promotion_scheme_item; priKind ITEM | ITEM_GROUP | ITEM_CATEGORY | ITEM_BRAND | ITEM_SECTION */
export interface SchemeItemInput {
  priId: string;
  priKind: string;
  priScopeId: string;
  priScopeName?: string | null;
  /** The item_unit_conversion id (the phone's iucId) the row binds, required on ITEM rows, null otherwise. */
  priUnitId: string | null;
  priUnitName?: string | null;
  priIsExclude: Flag;
  priDiscPerc: string;
  priDiscQty: string;
  priDiscAmt: string;
  priMinQty: string;
  priFactor: string;
  priMaxBenefit: string;
  priMatchPriority: number;
}

/** promotion_scheme_slab */
export interface SchemeSlabInput {
  prsId: string;
  prsSlno?: number;
  prsBenefit?: string;
  prsExceeds: string;
  /** null = open-ended (0 is a legal ceiling). */
  prsUpto: string | null;
  prsEach: string;
  prsIsRepeat: Flag;
  prsMaxRepeats: number;
  prsFreeItemId: string | null;
  prsFreeItemName?: string | null;
  prsFreeUnitId: string | null;
  prsFreeUnitName?: string | null;
  prsFreeUnitFactor?: string | null;
  prsFreeQty: string;
  prsFreeStockCheck: Flag;
  prsDiscPerc: string;
  prsDiscQty: string;
  prsDiscAmt: string;
  /** null = no fixed price. */
  prsFixedPrice: string | null;
  prsMaxBenefitAmt: string;
}

/** promotion_scheme with its children. */
export interface SchemeInput {
  prmId: string;
  prmCompId: string;
  prmBranchId: string | null;
  prmCode: string;
  prmName: string;
  prmStatus: string;
  prmApplyOn: string;
  prmBenefit: string;
  prmPriority: number;
  prmStackMode: string;
  prmAutoApply: Flag;
  prmAllowWithManualDisc: Flag;
  prmCalcOnAmountType: string;
  prmIncludeTax?: Flag;
  prmBillType: string;
  prmMinBillAmount: string;
  prmMinQty: string;
  prmBranchScope: string;
  prmCustScope: string;
  prmItemScope: string;
  prmPriceLevelId: number | null;
  prmMaxBenefitPerBill: string;
  prmCouponBatchId: string | null;
  prmStartDate: string;
  prmEndDate: string;
  prmValidFromTime: string | null;
  prmValidToTime: string | null;
  prmValidWeekdays: string | null;
  prmRemarks?: string | null;
  prmModifiedOn?: string | null;
  branches: readonly SchemeBranchInput[];
  parties: readonly SchemePartyInput[];
  items: readonly SchemeItemInput[];
  slabs: readonly SchemeSlabInput[];
}

// ---------------------------------------------------------------------------------------------
// Parsed: what the rules and the engine read (promotion_rules.h)
// ---------------------------------------------------------------------------------------------

export const PromoCode = {
  BillAmount: 'BILL_AMOUNT',
  BillQty: 'BILL_QTY',
  ItemAmount: 'ITEM_AMOUNT',
  ItemQty: 'ITEM_QTY',
  FreeItem: 'FREE_ITEM',
  DiscPerc: 'DISC_PERC',
  DiscAmt: 'DISC_AMT',
  FixedPrice: 'FIXED_PRICE',
  DiscPerItem: 'DISC_PER_ITEM',
  Approved: 'APPROVED',
  Exclusive: 'EXCLUSIVE',
  ScopeAll: 'ALL',
  ScopeList: 'LIST',
  GrossAmount: 'GROSS_AMOUNT',
  NetAmount: 'NET_AMOUNT',
  TaxableAmount: 'TAXABLE_AMOUNT',
  BillAll: 'ALL',
  BillCash: 'CASH',
  BillCredit: 'CREDIT',
  Customer: 'CUSTOMER',
  CustomerGroup: 'CUSTOMER_GROUP',
  Area: 'AREA',
  City: 'CITY',
  Item: 'ITEM',
  ItemGroup: 'ITEM_GROUP',
  ItemCategory: 'ITEM_CATEGORY',
  ItemBrand: 'ITEM_BRAND',
  ItemSection: 'ITEM_SECTION',
  FreeTypeScheme: 'SCHEME',
} as const;

/** One offer band (PromoSlab). Bounds are rupees for a *_AMOUNT trigger, quantity for *_QTY. */
export interface PromoSlab {
  id: string;
  benefit: string;
  exceeds: number;
  upto: number;
  /** 0 is a legal bound, NULL is not the same. */
  hasUpto: boolean;
  each: number;
  isRepeat: boolean;
  /** 0 = unlimited within the band. */
  maxRepeats: number;
  freeItemId: string;
  freeUnitId: string;
  freeItemName: string;
  freeUnitName: string;
  freeQty: number;
  freeStockCheck: boolean;
  discPerc: number;
  /** Rupees off PER UNIT. */
  discQty: number;
  /** Flat rupees off. */
  discAmt: number;
  fixedPrice: number;
  hasFixedPrice: boolean;
  /** 0 = uncapped, per band. */
  maxBenefitAmt: number;
}

export interface PromoItemRow {
  id: string;
  kind: string;
  scopeId: string;
  unitId: string;
  /** Names for the screens (the engine does not read them). */
  unitName: string;
  scopeName: string;
  isExclude: boolean;
  discPerc: number;
  discQty: number;
  discAmt: number;
  minQty: number;
  factor: number;
  /** 0 = uncapped, per line. */
  maxBenefit: number;
  matchPriority: number;
}

export interface PromoPartyRow {
  id: string;
  kind: string;
  scopeId: string;
  scopeName: string;
  isExclude: boolean;
  matchPriority: number;
}

export interface PromoBranchRow {
  id: string;
  branchId: string;
  branchName: string;
  isExclude: boolean;
}

export interface PromoScheme {
  id: string;
  code: string;
  name: string;
  compId: string;
  /** '' = every branch. */
  branchId: string;
  status: string;
  applyOn: string;
  benefit: string;
  priority: number;
  stackMode: string;
  autoApply: boolean;
  allowWithManualDisc: boolean;
  calcOnAmountType: string;
  includeTax: boolean;
  billType: string;
  minBillAmount: number;
  minQty: number;
  branchScope: string;
  custScope: string;
  itemScope: string;
  /** 0 = every price level. */
  priceLevelId: number;
  maxBenefitPerBill: number;
  /** Non-empty = needs a code. */
  couponBatchId: string;
  /** 'YYYY-MM-DD', '' = not valid. */
  startDate: string;
  endDate: string;
  /** Seconds since midnight, null = not valid. */
  validFrom: number | null;
  validTo: number | null;
  hasTimeWindow: boolean;
  /** "MON,TUE,..."; '' = every day. */
  validWeekdays: string;
  isActive: boolean;
  branches: PromoBranchRow[];
  parties: PromoPartyRow[];
  items: PromoItemRow[];
  slabs: PromoSlab[];
  /** Keyed "KIND|scopeId" -> index into items / parties; branchIndex by branch id alone. */
  itemIndex: Map<string, number>;
  partyIndex: Map<string, number>;
  branchIndex: Map<string, number>;
}

/** What the host knows and the rules need (PromoDocContext). Empty text / 0 = unknown. */
export interface PromoDocContext {
  compId: string;
  branchId: string;
  /** 'YYYY-MM-DD'. */
  docDate: string;
  /** 'HH:MM:SS'. */
  docTime: string;
  billType: string;
  custId: string;
  custGroupId: string;
  areaId: string;
  cityId: string;
  priceLevelId: number;
  /** The document's Apply offers switch. */
  promotionsEnabled: boolean;
}

/** What one line looks like to the rules (PromoLine). */
export interface PromoLine {
  row: number;
  itemId: string;
  unitId: string;
  groupId: string;
  categoryId: string;
  brandId: string;
  sectionId: string;
  netQty: number;
  rate: number;
  gross: number;
  netGross: number;
  taxable: number;
  schemeFlag: boolean;
  isFree: boolean;
  hasManualDisc: boolean;
}

/** One line's share of everything that matched it (PromoLineOutcome). */
export interface PromoLineOutcome {
  row: number;
  schPerc: number;
  schPerQty: number;
  schAmt: number;
  billSchPerc: number;
  fixedPrice: number;
  hasFixedPrice: boolean;
  schemeId: string;
  schemeName: string;
}

/** A giveaway (PromoFreeLine). */
export interface PromoFreeLine {
  itemId: string;
  unitId: string;
  itemName: string;
  unitName: string;
  qty: number;
  schemeId: string;
  schemeName: string;
  stockCheck: boolean;
  /** Insert below this line's row; -1 = append. */
  afterRow: number;
}

/** Why a scheme did not give a document-level pass (first failing check, in the Qt order). */
export type LiveFail = 'status' | 'autoApply' | 'coupon' | 'company' | 'headerBranch' | 'notStarted' | 'ended' | 'weekday' | 'time' | 'billType' | 'priceLevel';

/** Why one line was not counted by a scheme. */
export type SkipWhy = 'flagOff' | 'claimed' | 'manualDisc' | 'excluded' | 'unit' | 'lineMinQty' | 'notListed';

export type TraceStatus = 'applied' | 'notLive' | 'branch' | 'customer' | 'noLine' | 'minQty' | 'minAmount' | 'noBand' | 'noPayout' | 'noFreeItem' | 'noBenefit' | 'noRate';

/** What happened to one scheme in one pass. Not in the Qt engine: it is how explain() knows why. */
export interface SchemeTrace {
  schemeId: string;
  status: TraceStatus;
  liveFail: LiveFail | null;
  /** Σ over the counted lines: money (calc-on) and quantity. */
  money: number;
  qty: number;
  /** The scheme's own measure: money for *_AMOUNT, quantity for *_QTY. */
  measure: number;
  /** Indices (into the lines passed in) of the lines the scheme counted. */
  counted: number[];
  skipped: { index: number; why: SkipWhy }[];
  band: PromoSlab | null;
  payouts: number;
  /** The money the scheme gave (rupees), 0 for a free item. */
  benefit: number;
}

export interface PromoResult {
  /** One per input line, same order. */
  lines: PromoLineOutcome[];
  freeLines: PromoFreeLine[];
  /** Schemes skipped, and why (the Qt wording). */
  notes: string[];
  totalBenefit: number;
  /** One per scheme walked, in walk order. */
  traces: SchemeTrace[];
}

/** True when the outcome carries anything to write (PromoLineOutcome::touched). */
export const outcomeTouched = (o: PromoLineOutcome): boolean => o.schPerc !== 0 || o.schPerQty !== 0 || o.schAmt !== 0 || o.billSchPerc !== 0 || o.hasFixedPrice;

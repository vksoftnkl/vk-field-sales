// Pure TypeScript (no React Native imports) so `npm test` can run it against a fake server.

/**
 * The phone's only HTTP client: VK Nex's own routes, used by Sync. It signs in as the salesman
 * (POST /auth/login, the same user and password as on the phone) and sends the access token.
 */

/** One reason from VK Nex: { field, message, code } (CUSTOMER_NAME_EXISTS, VALIDATION_…). */
export interface ApiErrorDetail {
  field?: string;
  message: string;
  code?: string;
}

/** VK Nex answered, but not with success. */
export class ApiError extends Error {
  readonly kind = 'api';
  readonly status: number;
  readonly details: readonly ApiErrorDetail[];
  // Plain fields, not constructor shorthand: Node's type stripping (npm test) can't run that.
  constructor(status: number, message: string, details: readonly ApiErrorDetail[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
  get code(): string | undefined {
    return this.details.find((d) => d.code)?.code;
  }
}

/** No answer at all: server PC off, wrong address, not on the office Wi-Fi, or a timeout. */
export class NetworkError extends Error {
  readonly kind = 'network';
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export const isApiError = (e: unknown): e is ApiError => (e as { kind?: unknown } | null)?.kind === 'api';

/**
 * VK Nex has no such route: it is older than the phone (e.g. the phone port 3012 still runs the
 * build from before /mobile/receipts). Nest answers 404 'Cannot POST …' (code HTTP_404), unlike a
 * refusal of one record, which carries VK Nex's own code.
 */
export const isRouteMissing = (e: unknown): e is ApiError =>
  isApiError(e) && e.status === 404 && (e.code === 'HTTP_404' || /^Cannot (GET|POST|PUT|DELETE) /.test(e.message));
export const isNetworkError = (e: unknown): e is NetworkError => (e as { kind?: unknown } | null)?.kind === 'network';

export interface ServerCredentials {
  loginName: string;
  password: string;
}

/** The VK Nex user a sign-in was for (POST /auth/login answers usrId and user_name). */
export interface SignedInUser {
  /** user_master.usr_id; null if VK Nex sent neither usrId nor a token with a sub. */
  usrId: string | null;
  /** usr_login_name, spelled as VK Nex keeps it. */
  loginName: string;
}

export interface CustomerOptions {
  areas: { id: string; name: string; cityName: string | null }[];
  groups: { id: string; name: string }[];
  priceLevels: { id: number; name: string }[];
  states: { code: string; name: string }[];
  gstTypes: readonly string[];
}

/** The fields of a saved customer the phone keeps (VK Nex returns the whole customer). */
export interface SavedCustomer {
  cusId: string;
  cusCode: string | null;
  cusName: string | null;
}

export interface CustomerSearchRow {
  cusId: string;
  cusName: string | null;
  cusCode: string | null;
  cusPhone1: string | null;
  cusGstNo: string | null;
}

/** A financial year of the company (GET /master-lookups/fiscal-years/by-company/:id). */
/** A branch of a company (GET /master-lookups/branches/by-company/:id), in VK Nex's order. */
export interface BranchOption {
  id: string;
  name: string;
  /** Only /mobile/items/options says which branch is the company's default. */
  isDefault?: boolean;
}

export interface FiscalYearOption {
  id: string;
  /** '2026-2027': the accYear of VK Nex's reports. */
  name: string;
  beginDate: string | null;
  endDate: string | null;
  status: string;
  isCurrent: boolean;
}

/** { amount: '38450.00', side: 'DR' | 'CR' } — VK Nex never uses a minus sign for balances. */
export interface SidedAmount {
  amount: string;
  side: 'DR' | 'CR';
}

/** One voucher of GET /reports/ledger-statement/vouchers (the fields the phone keeps). */
export interface LedgerVoucherRow {
  voucherId: string;
  accYear: string;
  date: string;
  voucherTypeName: string | null;
  voucherNo: string | null;
  rowKind: string;
  particulars: string | null;
  narration: string | null;
  billRefs: string[];
  debit: string;
  credit: string;
  balance: SidedAmount;
  src: { module: string | null; docType: string | null; docId: string | null };
}

export interface LedgerVouchersPage {
  /** Balance at fromDate, before this page's first row. */
  broughtForward: SidedAmount;
  rows: LedgerVoucherRow[];
  /** Balance after this page's last row. */
  carriedForward: SidedAmount;
  page: { page: number; pageSize: number; totalRows: number };
}

export interface LedgerQuery {
  companyId: string;
  accYear: string;
  ledgerId: string;
  fromDate: string;
  toDate: string;
  page: number;
  pageSize: number;
}

/** GET /mobile/items/options: what Order entry picks from. */
export interface ItemOptions {
  /** Active companies: the phone's Choose company list. */
  companies: { id: string; name: string; place: string | null }[];
  /**
   * The active branches of those companies, in VK Nex's order (since 2026-11-18; absent on an
   * older VK Nex, which the phone then asks per company over https).
   */
  branches?: { id: string; name: string; companyId: string; isDefault: boolean }[];
  /** position = VK Nex's sort order; null = unsorted (after the sorted ones). */
  itemGroups: { id: string; name: string; position: number | null }[];
  brands: { id: string; name: string; position: number | null }[];
  /** Selling levels without Cost (7). 1-4 price from priceA-priceD, 5 is the MRP, 6 the minimum. */
  priceLevels: { id: number; name: string }[];
}

/** One unit an item is ordered in, priced as VK Nex's /master-lookups/item-price prices it. */
export interface MobileItemUnit {
  /** item_unit_conversion.iuc_id: what an order line's soiItemUnitId takes. */
  iucId: string;
  unitId: string;
  unitName: string | null;
  /** Quantity in this unit × factor = quantity in the base unit. */
  factor: number;
  isDefaultUnit: boolean;
  isBaseUnit: boolean;
  weight: number;
  /** false = no live price row prices the unit today: every price below is null. */
  priced: boolean;
  /** Money as text, two decimals. */
  priceA: string | null;
  priceB: string | null;
  priceC: string | null;
  priceD: string | null;
  mrp: string | null;
  minPrice: string | null;
  loadingCharge: string | null;
  freightCharge: string | null;
  /** Saleable stock free to sell in the company, in this unit (3 decimals). */
  availableQty: number;
}

/** One orderable item of GET /mobile/items/list (the fields the phone keeps). */
export interface MobileItem {
  itemId: string;
  itemCode: string | null;
  itemNameEn: string;
  itemNameTa: string | null;
  itemGroupId: string;
  itemBrandId: string | null;
  allowLoading: boolean;
  allowFreight: boolean;
  allowPromo: boolean;
  inclTax: boolean;
  hsnCode: string | null;
  taxId: string | null;
  /** '5.000'; '0.000' when the company is not GST applicable. */
  taxPerc: string;
  units: MobileItemUnit[];
}

export interface ItemListPage {
  items: MobileItem[];
  total: number;
  hasMore: boolean;
  /** The branch the prices were read for (the phone's own, else the company's default). */
  branchId: string | null;
}

/** VK Nex's answer to POST /mobile/orders/create, for a new order and a resend alike. */
export interface CreatedOrder {
  soId: string;
  soOrderRefno: string;
  /** Now: 'DRAFT' when just saved; a resend reads the stored one. */
  soStatus: string;
  soAccYear: string;
  /** This soClientUuid was saved before; nothing was written this time. */
  duplicate: boolean;
  /** A resend of an order the office has deleted since. */
  soIsDeleted: boolean;
}

/** VK Nex's answer to POST /mobile/visits/create. */
export interface CreatedVisit {
  cvId: string;
  cvClientUuid: string;
  cvVisitAt: string;
  duplicate: boolean;
}

/**
 * GET /mobile/receipts/options: the branch VK Nex books the phone's receipts in, and the company's
 * active tenders (cash, UPI, bank, cheque, card / wallet). Keys as the server session's builder
 * wrote them (2026-11-17, not yet checked live on :3011).
 */
export interface MobileTender {
  /** acc_tender_master.tnd_id: goes as tdTenderId. */
  tenderId: string;
  /** Goes as tdTenderTypeId: 1 cash, 2 card, 3 UPI, 4 wallet, 5 cheque, 6 bank. */
  typeId: number | string;
  typeCode?: string | null;
  name?: string | null;
  shortName?: string | null;
  needsRef?: boolean | null;
  refLabel?: string | null;
  /** The tender to start a receipt with. */
  isDefault?: boolean | null;
  /** Surcharge the customer pays on top (text, '1.00' % and '0.00' flat); it goes inside tdAmount. */
  surchargePerc?: string | number | null;
  surchargeAmount?: string | number | null;
}

export interface ReceiptOptions {
  companyId?: string;
  branchId: string | null;
  tenders: MobileTender[];
}

/** One open bill of a company's customer, in VK Nex's /receipts/open-items order. Amounts in rupees. */
export interface MobileOpenBill {
  partyId: string;
  billId: string;
  billAccYear: string;
  billType?: string | null;
  docRefno?: string | null;
  docDate?: string | null;
  dueDate?: string | null;
  billAmount: number | string;
  pendingAmount: number | string;
}

export interface OpenBillsPage {
  items: MobileOpenBill[];
  hasMore: boolean;
}

/**
 * VK Nex's answer to POST /mobile/receipts/create (posted at once; a resend answers duplicate with
 * the status it has by then, which can be CANCELLED). Only the keys the phone keeps are typed.
 */
export interface CreatedReceipt {
  avhVoucherId: string;
  avhVoucherRefno: string | null;
  avhVoucherStatus: string;
  avhAccYear: string;
  duplicate: boolean;
  /** What VK Nex kept on account (text). */
  onAccount?: string | null;
  avhIsDeleted?: boolean;
}

/** The middle part of a JWT, read (not checked: VK Nex checks it on every request). */
export function readTokenClaims(token: string): Record<string, unknown> {
  const part = token.split('.')[1];
  if (!part) return {};
  try {
    const json = decodeBase64Url(part);
    const claims: unknown = JSON.parse(json);
    return claims && typeof claims === 'object' ? (claims as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64url → UTF-8 text, by hand: no atob / Buffer on every JS engine the app runs on. */
function decodeBase64Url(s: string): string {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const bytes: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('bad base64');
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    const n = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
    let cp = n === 1 ? b : b & (0xff >> (n + 1));
    for (let k = 1; k < n; k++) cp = (cp << 6) | ((bytes[i + k] ?? 0) & 0x3f);
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
}

interface Envelope<T> {
  success: boolean;
  message?: string;
  data: T;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface VkNexClientOptions {
  baseUrl: string;
  appVersion: string;
  /** Asked at sign-in, so a password typed on the Sync page is used straight away. */
  credentials: () => ServerCredentials | null;
  /**
   * This phone's device uid (VK Nex's fixed.device_master.dev_device_uid, entered on the Device
   * List screen). Sent at sign-in and with every order, visit and item list.
   */
  deviceUid?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/** First readable reason in a VK Nex error body ({ message, errors[] } or Nest's { message: string[] }). */
function readError(status: number, body: unknown): ApiError {
  const b = (body && typeof body === 'object' ? body : {}) as { message?: unknown; errors?: unknown };
  const details: ApiErrorDetail[] = Array.isArray(b.errors)
    ? b.errors
        .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
        .map((d) => ({
          field: typeof d.field === 'string' ? d.field : undefined,
          message: typeof d.message === 'string' ? d.message : '',
          code: typeof d.code === 'string' ? d.code : undefined,
        }))
    : [];
  const message =
    details.find((d) => d.message)?.message ??
    (Array.isArray(b.message) ? b.message.join(', ') : typeof b.message === 'string' ? b.message : `HTTP ${status}`);
  return new ApiError(status, message, details);
}

type Method = 'GET' | 'POST' | 'PUT';

export function createVkNexClient(opts: VkNexClientOptions) {
  const doFetch: FetchLike = opts.fetch ?? (fetch as unknown as FetchLike);
  let token: string | null = null;
  /** dev_id of the registered device VK Nex matched at sign-in; null = not registered (or blocked). */
  let deviceId: string | null = null;

  async function call<T>(method: Method, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-App-Platform': 'mobile',
      'X-App-Version': opts.appVersion,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
    let res: Awaited<ReturnType<FetchLike>>;
    try {
      res = await doFetch(`${opts.baseUrl}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (e) {
      throw new NetworkError(e instanceof Error ? e.message : 'Network request failed');
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) throw readError(res.status, data);
    return data as T;
  }

  async function login(): Promise<SignedInUser> {
    const c = opts.credentials();
    if (!c) throw new ApiError(401, 'No VK Nex user to sign in with');
    const body: Record<string, string> = { usrLoginName: c.loginName, usrPassword: c.password, app_version: opts.appVersion, device_type: 'Mobile' };
    if (opts.deviceUid) body.device_id = opts.deviceUid;
    const r = await call<{ access_token: string; device_id?: string | null; usrId?: unknown; user_name?: unknown }>('POST', '/auth/login', body, false);
    token = r.access_token;
    deviceId = typeof r.device_id === 'string' && r.device_id ? r.device_id : null;
    // Without usrId in the answer, the token's sub is the same id.
    const sub = readTokenClaims(r.access_token).sub;
    const usrId = typeof r.usrId === 'string' && r.usrId ? r.usrId : typeof sub === 'string' && sub ? sub : null;
    return { usrId, loginName: typeof r.user_name === 'string' && r.user_name ? r.user_name : c.loginName };
  }

  /** Signs in when needed, and once more if the token has run out mid-sync. */
  async function authed<T>(method: Method, path: string, body?: unknown): Promise<T> {
    if (!token) await login();
    try {
      return await call<T>(method, path, body);
    } catch (e) {
      if (!isApiError(e) || e.status !== 401) throw e;
      token = null;
      await login();
      return call<T>(method, path, body);
    }
  }

  return {
    /** Server reachable? No sign-in needed. */
    health: () => call<unknown>('GET', '/health', undefined, false).then(() => undefined),
    login,
    customerOptions: () => authed<Envelope<CustomerOptions>>('GET', '/mobile/customers/options').then((r) => r.data),
    createCustomer: (payload: Record<string, unknown>) =>
      authed<Envelope<SavedCustomer>>('POST', '/mobile/customers/create', payload).then((r) => r.data),
    searchCustomers: (search: string) =>
      authed<Envelope<{ items: CustomerSearchRow[] }>>('GET', `/mobile/customers/list?search=${encodeURIComponent(search)}&pageSize=50`).then(
        (r) => r.data.items,
      ),
    /** One page of all customers (200 is VK Nex's largest page). */
    customerListPage: (page: number, pageSize = 200) =>
      authed<Envelope<{ items: CustomerSearchRow[]; hasMore: boolean }>>('GET', `/mobile/customers/list?page=${page}&pageSize=${pageSize}`).then(
        (r) => r.data,
      ),
    /** Changes a customer: the save payload with cusId (only the fields sent change). */
    updateCustomer: (payload: Record<string, unknown>) =>
      authed<Envelope<SavedCustomer>>('PUT', '/mobile/customers/update', payload).then((r) => r.data),
    /**
     * The company VK Nex signed the user in to (the token's company_id): the books the Ledger
     * statement reads. Null before sign-in or for a user without a company.
     */
    companyId: (): string | null => {
      const c = token ? readTokenClaims(token).company_id : null;
      return typeof c === 'string' && c ? c : null;
    },
    /** The company's branches, for Switch company (the lookup the VK Nex desktop's Select Branch uses). */
    branchesByCompany: (companyId: string) =>
      authed<Envelope<BranchOption[]>>('GET', `/master-lookups/branches/by-company/${encodeURIComponent(companyId)}`).then((r) => r.data),
    fiscalYears: (companyId: string) =>
      authed<Envelope<FiscalYearOption[]>>('GET', `/master-lookups/fiscal-years/by-company/${encodeURIComponent(companyId)}`).then((r) => r.data),
    /** One page of a ledger's vouchers for a period inside one financial year (≤ 1000 a page). */
    ledgerPage: (q: LedgerQuery) => {
      const qs = Object.entries(q)
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&');
      return authed<Envelope<LedgerVouchersPage>>('GET', `/reports/ledger-statement/vouchers?${qs}`).then((r) => r.data);
    },
    /**
     * Whether VK Nex matched this phone to a registered, active device at the last sign-in. Orders
     * and visits are refused (403 MOBILE_DEVICE_*) until it is.
     */
    deviceRegistered: (): boolean => deviceId !== null,
    itemOptions: () => authed<Envelope<ItemOptions>>('GET', '/mobile/items/options').then((r) => r.data),
    /**
     * One page of the items orderable for a company, with units, prices and stock (≤ 500 a page).
     * The phone's device uid is sent only once VK Nex knows the phone: then prices are its branch's.
     * Otherwise VK Nex answers for the company's default branch (an unknown uid would be a 403).
     */
    itemListPage: (companyId: string, page: number, pageSize = 500) => {
      const device = deviceId && opts.deviceUid ? `&deviceUid=${encodeURIComponent(opts.deviceUid)}` : '';
      return authed<Envelope<ItemListPage>>(
        'GET',
        `/mobile/items/list?companyId=${encodeURIComponent(companyId)}&page=${page}&pageSize=${pageSize}${device}`,
      ).then((r) => r.data);
    },
    /** One order with its lines. Safe to resend: the same soClientUuid answers the order saved before. */
    createOrder: (payload: Record<string, unknown>) =>
      authed<Envelope<CreatedOrder>>('POST', '/mobile/orders/create', { ...payload, deviceUid: opts.deviceUid }).then((r) => r.data),
    /** A company's tenders for receipts (and the branch VK Nex books them in). */
    receiptOptions: (companyId: string) => {
      const device = deviceId && opts.deviceUid ? `&deviceUid=${encodeURIComponent(opts.deviceUid)}` : '';
      return authed<Envelope<ReceiptOptions>>('GET', `/mobile/receipts/options?companyId=${encodeURIComponent(companyId)}${device}`).then((r) => r.data);
    },
    /** One page of a company's open bills, every customer, in the order VK Nex fills them. */
    openBillsPage: (companyId: string, page: number, pageSize = 200) =>
      authed<Envelope<OpenBillsPage>>(
        'GET',
        `/mobile/receipts/open-bills?companyId=${encodeURIComponent(companyId)}&page=${page}&pageSize=${pageSize}`,
      ).then((r) => r.data),
    /** One receipt, saved and posted. Safe to resend: the same avhClientUuid answers the receipt saved before. */
    createReceipt: (payload: Record<string, unknown>) =>
      authed<Envelope<CreatedReceipt>>('POST', '/mobile/receipts/create', { ...payload, deviceUid: opts.deviceUid }).then((r) => r.data),
    /** One check-in. Safe to resend, as orders. */
    createVisit: (payload: Record<string, unknown>) =>
      authed<Envelope<CreatedVisit>>('POST', '/mobile/visits/create', { ...payload, deviceUid: opts.deviceUid }).then((r) => r.data),
    /** The whole customer: VK Nex's desktop payload, same field names as the phone's table. */
    getCustomer: (cusId: string) =>
      authed<Envelope<Record<string, unknown>>>('GET', `/mobile/customers/get?cusId=${encodeURIComponent(cusId)}`).then((r) => r.data),
  };
}

export type VkNexClient = ReturnType<typeof createVkNexClient>;

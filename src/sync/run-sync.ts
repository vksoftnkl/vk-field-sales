import Constants from 'expo-constants';

import { getMeta, setMeta } from '@/db/meta';
import { companiesQuery, ensureCurrentCompany } from '@/features/company/company';
import { todayISO } from '@/lib/money';

import { getServerCredentials } from './credentials';
import { apiBaseUrl, type ServerAddress } from './server-address';
import { branchesFromOptions, downloadBranches } from './download-branches';
import { downloadCustomers } from './download-customers';
import { downloadSchemes } from './download-schemes';
import { downloadItems } from './download-items';
import { downloadLedgers } from './download-ledgers';
import { downloadReceiptData } from './download-receipt-data';
import {
  getDeviceUid,
  getServerAddress,
  applyReceiptStatus,
  ledgerCustomerIds,
  markCustomerRefused,
  markCustomerSynced,
  markCustomerUpdated,
  markOrderRefused,
  markOrderSynced,
  markReceiptRefused,
  markReceiptTried,
  markReceiptSynced,
  markVisitRefused,
  markVisitSynced,
  pendingCustomers,
  pendingEdits,
  pendingOrders,
  pendingReceipts,
  pendingVisits,
  saveBranches,
  saveSchemes,
  saveCustomerOptions,
  saveDownloadedCustomers,
  saveItemList,
  saveItemOptions,
  saveLedgers,
  saveMe,
  saveReceiptData,
  type SavedDownload,
} from './sync-store';
import { updateCustomers, type UpdateOutcome } from './update-customers';
import { uploadCustomers, type UploadOutcome } from './upload-customers';
import { uploadOrders, type OrderOutcome } from './upload-orders';
import { uploadReceipts, type ReceiptOutcome } from './upload-receipts';
import { uploadVisits, type VisitOutcome } from './upload-visits';
import { createVkNexClient, type ApiError, type CustomerOptions, type ServerCredentials, type SignedInUser } from './vk-nex-api';

export type SyncStep =
  | 'signIn'
  | 'masters'
  | 'upload'
  | 'update'
  | 'orders'
  | 'visits'
  | 'receipts'
  | 'download'
  | 'items'
  | 'branches'
  | 'schemes'
  | 'receiptData'
  | 'receiptStatus'
  | 'ledger';

export interface SyncReport {
  outcomes: UploadOutcome[];
  /** Edits sent (Edit customer). */
  updates: UpdateOutcome[];
  /** Orders and check-ins sent (absent when the run stopped before them). */
  orders?: OrderOutcome[];
  visits?: VisitOutcome[];
  /** Receipts sent (absent when the run stopped before them). */
  receipts?: ReceiptOutcome[];
  /** VK Nex refused receipts from this login (403, e.g. no Post right on Receipt, menu 99). They wait. */
  receiptsRefusedBy?: ApiError;
  /** VK Nex has no receipts route yet (older build on this port). They wait. */
  receiptsRouteMissing?: boolean;
  /**
   * VK Nex refused the phone itself for orders / check-ins (403: not registered on the Device List
   * screen, blocked, switched off). Those wait; the downloads still ran.
   */
  sendRefusedBy?: ApiError;
  /** Whether VK Nex matched this phone to a registered device at sign-in. */
  deviceRegistered?: boolean;
  /** Items brought (for how many companies); absent when the run stopped before that step. */
  items?: { companies: number; items: number };
  /** Why the items did not come; the phone keeps the ones it had. Reported apart from stoppedBy. */
  itemsStoppedBy?: unknown;
  /** Branches brought for Switch company (companies read, branches). */
  branches?: { companies: number; branches: number };
  /** Why they did not come; the phone keeps the ones it had. */
  branchesStoppedBy?: unknown;
  /** Offers (promotion schemes) brought for orders (companies read, schemes). */
  schemes?: { companies: number; schemes: number };
  /** Why they did not come; the phone keeps the ones it had. */
  schemesStoppedBy?: unknown;
  /** Tenders and open bills brought for receipts (companies read, bills). */
  receiptData?: { companies: number; bills: number };
  /** Why they did not come; the phone keeps what it had. */
  receiptDataStoppedBy?: unknown;
  /** This phone's receipts changed in VK Nex (cancelled in the office, PDC cleared …). */
  receiptStatus?: { changed: number };
  receiptStatusStoppedBy?: unknown;
  /** VK Nex's customers brought to the phone; absent when the run stopped before that step. */
  downloaded?: SavedDownload & { skipped: number };
  /** Ledgers brought (this and last financial year): customers read and skipped. */
  ledger?: { read: number; skipped: number };
  /**
   * Why the ledgers did not come (no right to VK Nex's Ledger Statement, no company …). The
   * customers are saved by then, so this is reported apart from stoppedBy.
   */
  ledgerStoppedBy?: unknown;
  /** Why the run stopped before the end (no address, server unreachable, sign-in refused …). */
  stoppedBy?: unknown;
  /** The step it stopped at. */
  stoppedAt?: SyncStep;
}

const appVersion = () => Constants.expoConfig?.version ?? '0.0.0';

const clientFor = (address: ServerAddress) =>
  createVkNexClient({ baseUrl: apiBaseUrl(address), appVersion: appVersion(), credentials: getServerCredentials, deviceUid: getDeviceUid() });

/**
 * VK Nex's employee_master id of a phone salesman, which a check-in must name (cvSalesmanId).
 * Not known yet: the phone knows its users only by VK Nex's usr_id (from /auth/login), and VK Nex
 * sends no user → employee link. Until it does, check-ins wait on the phone with NO_SALESMAN
 * (see docs/SYNC-API.md, Visits).
 */
const salesmanOf = (_userId: string): string | null => null;

/** Short: the login page waits on this, and a phone outside the office gets no answer at all. */
const LOGIN_TIMEOUT_MS = 10_000;

/**
 * Asks VK Nex whether a login name and password are right (POST /auth/login), for a login the
 * phone can't check by itself. Throws NetworkError / ApiError (401 = not accepted).
 */
export function checkLogin(address: ServerAddress, credentials: ServerCredentials): Promise<SignedInUser> {
  return createVkNexClient({
    baseUrl: apiBaseUrl(address),
    appVersion: appVersion(),
    credentials: () => credentials,
    deviceUid: getDeviceUid(),
    timeoutMs: LOGIN_TIMEOUT_MS,
  }).login();
}

/** "Test connection": is VK Nex answering at this address? Throws NetworkError / ApiError if not. */
export function testConnection(address: ServerAddress): Promise<void> {
  return clientFor(address).health();
}

let running: Promise<SyncReport> | null = null;

type BranchesBrought = NonNullable<SyncReport['branches']>;

/**
 * VK Nex's companies with their branches (when this VK Nex sends them with the options), groups
 * and brands. `branches` is null when it does not: the caller then asks per company.
 */
async function bringOptions(api: ReturnType<typeof clientFor>): Promise<{ companyIds: string[]; branches: BranchesBrought | null }> {
  const itemOptions = await api.itemOptions();
  saveItemOptions(itemOptions);
  const withOptions = branchesFromOptions(itemOptions);
  if (withOptions) saveBranches(withOptions);
  ensureCurrentCompany();
  return {
    companyIds: itemOptions.companies.map((c) => c.id),
    branches: withOptions ? { companies: withOptions.companyIds.length, branches: withOptions.rows.length } : null,
  };
}

/** Every company's branches, one GET each (older VK Nex; this route answers over https only). */
async function bringBranchesPerCompany(api: ReturnType<typeof clientFor>, companyIds: string[]): Promise<BranchesBrought> {
  const got = await downloadBranches(companyIds, (companyId) => api.branchesByCompany(companyId));
  saveBranches(got);
  ensureCurrentCompany();
  return { companies: got.companyIds.length, branches: got.rows.length };
}

/** VK Nex's companies (with branches), groups, brands and every company's items with prices and stock. */
async function bringItems(
  api: ReturnType<typeof clientFor>,
  onStep: (step: SyncStep, done?: number, total?: number) => void,
): Promise<NonNullable<SyncReport['items']> & { branches: BranchesBrought | null }> {
  onStep('items', 0, 0);
  const options = await bringOptions(api);
  const got = await downloadItems(
    options.companyIds,
    {
      listPage: (companyId, page) => api.itemListPage(companyId, page),
      onProgress: (done, total) => onStep('items', done, total),
    },
  );
  saveItemList(got);
  return { companies: got.companyIds.length, items: got.items.length, branches: options.branches };
}

/**
 * Every company's offers (GET /mobile/schemes/active), each company's set replaced as a whole.
 * All companies are read first: a failure keeps the offers the phone had.
 */
async function bringSchemes(
  api: ReturnType<typeof clientFor>,
  companyIds: readonly string[],
  onStep: (step: SyncStep, done?: number, total?: number) => void,
): Promise<NonNullable<SyncReport['schemes']>> {
  onStep('schemes', 0, companyIds.length);
  const syncedOn = new Date().toISOString();
  const sets = await downloadSchemes(companyIds, (companyId) => api.activeSchemes(companyId), syncedOn, (done, total) => onStep('schemes', done, total));
  saveSchemes(sets, syncedOn);
  return { companies: sets.length, schemes: sets.reduce((n, c) => n + c.schemes.length, 0) };
}

let pullingBranches: Promise<number> | null = null;

/**
 * Switch company found no branches for a company on the phone: sign in and bring every company's
 * branches again (with the companies, as Sync does). Resolves to how many branches the phone has
 * now. Throws as Sync's steps do (NO_SERVER_ADDRESS, NetworkError, ApiError); the phone keeps
 * its old ones then.
 */
export function refreshBranches(): Promise<number> {
  pullingBranches ??= (async () => {
    const address = getServerAddress();
    if (!address) throw new Error('NO_SERVER_ADDRESS');
    const api = clientFor(address);
    await api.login();
    const options = await bringOptions(api);
    return (options.branches ?? (await bringBranchesPerCompany(api, options.companyIds))).branches;
  })().finally(() => {
    pullingBranches = null;
  });
  return pullingBranches;
}

let refreshing: Promise<NonNullable<SyncReport['items']> & { schemesStoppedBy?: unknown }> | null = null;

/**
 * Refresh stock and prices (Add items): signs in and brings the items again, nothing else. Throws
 * as Sync's steps do (NO_SERVER_ADDRESS, NetworkError, ApiError); the phone keeps its old list then.
 */
export function refreshItems(
  onStep: (step: SyncStep, done?: number, total?: number) => void = () => {},
): Promise<NonNullable<SyncReport['items']> & { schemesStoppedBy?: unknown }> {
  refreshing ??= (async () => {
    const address = getServerAddress();
    if (!address) throw new Error('NO_SERVER_ADDRESS');
    const api = clientFor(address);
    onStep('signIn');
    await api.login();
    const items = await bringItems(api, onStep);
    // The offers come with the prices; the items stay refreshed if they fail.
    try {
      await bringSchemes(
        api,
        companiesQuery()
          .all()
          .map((c) => c.id),
        onStep,
      );
      return items;
    } catch (e) {
      return { ...items, schemesStoppedBy: e };
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * Sync, started by the salesman: sign in to VK Nex, bring its areas, customer groups and price
 * levels, send every customer added on the phone (POST /mobile/customers/create), every edit
 * (PUT /mobile/customers/update), every order (POST /mobile/orders/create), every check-in
 * (POST /mobile/visits/create) and every receipt (POST /mobile/receipts/create) — each marked
 * synced as soon as VK Nex has it — then bring all of VK Nex's customers to the phone, its
 * companies and items with prices and stock, each company's tenders and open bills, and last the
 * ledgers for this and last financial year. Customers go before orders and check-ins, which then
 * name them by VK Nex's id. Only one run at a time; a second tap joins it.
 */
export function runSync(onStep: (step: SyncStep, done?: number, total?: number) => void, opts: { sendOnly?: boolean } = {}): Promise<SyncReport> {
  // A tap while a run is going joins it (a full run sends everything a send-only run would).
  running ??= (async (): Promise<SyncReport> => {
    const address = getServerAddress();
    if (!address) return { outcomes: [], updates: [], stoppedBy: new Error('NO_SERVER_ADDRESS'), stoppedAt: 'signIn' };
    const api = clientFor(address);

    let step: SyncStep = 'signIn';
    let options: CustomerOptions;
    try {
      onStep('signIn');
      await api.login();
      // The login's employee (the receipts' collector) and rights. An older VK Nex has no
      // /mobile/me: the phone keeps what it had and assumes the rights.
      try {
        saveMe(await api.me());
      } catch {
        // not fatal
      }
      step = 'masters';
      onStep('masters');
      options = await api.customerOptions();
      saveCustomerOptions(options);
    } catch (e) {
      return { outcomes: [], updates: [], stoppedBy: e, stoppedAt: step };
    }

    onStep('upload', 0, 0);
    const pending = pendingCustomers();
    // Salesmen don't choose price levels: a new customer gets VK Nex's first one (lowest id);
    // the office can change it there.
    const result = await uploadCustomers(pending, options.priceLevels[0]?.id ?? null, {
      create: (p) => api.createCustomer(p),
      search: (name) => api.searchCustomers(name),
      markSynced: markCustomerSynced,
      markRefused: markCustomerRefused,
      onProgress: (done, total) => onStep('upload', done, total),
    });
    if (result.stoppedBy) return { outcomes: result.outcomes, updates: [], stoppedBy: result.stoppedBy, stoppedAt: 'upload' };

    onStep('update', 0, 0);
    const edits = await updateCustomers(pendingEdits(), {
      get: (cusId) => api.getCustomer(cusId),
      update: (p) => api.updateCustomer(p),
      markUpdated: markCustomerUpdated,
      markRefused: markCustomerRefused,
      onProgress: (done, total) => onStep('update', done, total),
    });
    const customersSent = { outcomes: result.outcomes, updates: edits.outcomes, deviceRegistered: api.deviceRegistered() };
    if (edits.stoppedBy) return { ...customersSent, stoppedBy: edits.stoppedBy, stoppedAt: 'update' };

    // Orders, then check-ins. A 403 (phone not registered / blocked) stops both but not the
    // downloads; no answer or a lost sign-in stops the whole run.
    onStep('orders', 0, 0);
    const orders = await uploadOrders(pendingOrders(), {
      create: (p) => api.createOrder(p),
      markSynced: markOrderSynced,
      markRefused: markOrderRefused,
      onProgress: (done, total) => onStep('orders', done, total),
    });
    let sent: Omit<SyncReport, 'stoppedBy' | 'stoppedAt'> = { ...customersSent, orders: orders.outcomes };
    if (orders.stoppedBy) return { ...sent, stoppedBy: orders.stoppedBy, stoppedAt: 'orders' };
    if (orders.refusedBy) {
      sent = { ...sent, sendRefusedBy: orders.refusedBy };
    } else {
      onStep('visits', 0, 0);
      const checkIns = await uploadVisits(pendingVisits(), {
        create: (p) => api.createVisit(p),
        currentCompanyId: getMeta('companyId'),
        salesmanOf,
        markSynced: markVisitSynced,
        markRefused: markVisitRefused,
        onProgress: (done, total) => onStep('visits', done, total),
      });
      sent = { ...sent, visits: checkIns.outcomes, sendRefusedBy: checkIns.refusedBy };
      if (checkIns.stoppedBy) return { ...sent, stoppedBy: checkIns.stoppedBy, stoppedAt: 'visits' };
    }

    // Receipts, posted by VK Nex as they arrive. Bills must go before them once the phone sends
    // bills, so that today's bill is open when VK Nex fills the oldest bills.
    if (!sent.sendRefusedBy) {
      onStep('receipts', 0, 0);
      const rcts = await uploadReceipts(pendingReceipts(), {
        create: (p) => api.createReceipt(p),
        markSynced: markReceiptSynced,
        markRefused: markReceiptRefused,
        markTried: markReceiptTried,
        onProgress: (done, total) => onStep('receipts', done, total),
      });
      sent = { ...sent, receipts: rcts.outcomes, receiptsRefusedBy: rcts.refusedBy, receiptsRouteMissing: !!rcts.routeMissing };
      if (rcts.stoppedBy) return { ...sent, stoppedBy: rcts.stoppedBy, stoppedAt: 'receipts' };
    }

    // Send now (My orders, a saved order): everything waiting has gone; nothing is brought.
    if (opts.sendOnly) return sent;

    let downloaded: SyncReport['downloaded'];
    try {
      const got = await downloadCustomers(
        {
          listPage: (page) => api.customerListPage(page),
          get: (cusId) => api.getCustomer(cusId),
          onProgress: (done, total) => onStep('download', done, total),
        },
        new Date().toISOString(),
      );
      const saved = saveDownloadedCustomers(got.rows, got.listedIds);
      downloaded = { ...saved, skipped: got.skipped };
    } catch (e) {
      return { ...sent, stoppedBy: e, stoppedAt: 'download' };
    }

    // Companies, groups and brands are saved as soon as they come; the items after all of them
    // are read. A failure keeps the phone's old price list and goes on to the ledgers.
    let items: SyncReport['items'];
    let itemsStoppedBy: unknown;
    let branches: BranchesBrought | null = null;
    try {
      const got = await bringItems(api, onStep);
      items = { companies: got.companies, items: got.items };
      branches = got.branches;
    } catch (e) {
      itemsStoppedBy = e;
    }
    sent = { ...sent, items, itemsStoppedBy };

    // Every company's branches for Switch company: they came with the companies above, or (older
    // VK Nex) one GET per company. A failure keeps the phone's old branches and goes on; a picked
    // branch that is gone is cleared. When the items step failed, its line already says why.
    if (branches) {
      sent = { ...sent, branches };
    } else if (!itemsStoppedBy) {
      try {
        onStep('branches', 0, 0);
        const ids = companiesQuery()
          .all()
          .map((c) => c.id);
        sent = { ...sent, branches: await bringBranchesPerCompany(api, ids) };
      } catch (e) {
        sent = { ...sent, branchesStoppedBy: e };
      }
    }

    // Offers for every company, after the items they name. A failure keeps the phone's old offers
    // and goes on (an older VK Nex has no offers route yet).
    try {
      const ids = companiesQuery()
        .all()
        .map((c) => c.id);
      sent = { ...sent, schemes: await bringSchemes(api, ids, onStep) };
    } catch (e) {
      sent = { ...sent, schemesStoppedBy: e };
    }

    // Tenders and open bills for the Receipt screens, after the receipts went (VK Nex's figures
    // then include them). A failure keeps the phone's old ones and goes on to the ledgers.
    try {
      onStep('receiptData', 0, 0);
      const got = await downloadReceiptData(
        companiesQuery()
          .all()
          .map((c) => c.id),
        {
          options: (companyId) => api.receiptOptions(companyId),
          openBillsPage: (companyId, page) => api.openBillsPage(companyId, page),
          onProgress: (done, total) => onStep('receiptData', done, total),
        },
        new Date().toISOString(),
      );
      saveReceiptData(got);
      sent = { ...sent, receiptData: { companies: got.companyIds.length, bills: got.bills.length } };
    } catch (e) {
      sent = { ...sent, receiptDataStoppedBy: e };
    }

    // This phone's receipts as VK Nex has them now: cancelled in the office, a post-dated cheque
    // cleared or bounced. Only changes since the last read (VK Nex's own clock); not fatal.
    try {
      onStep('receiptStatus', 0, 0);
      const since = getMeta('receiptStatusSince');
      // The next read starts from the EARLIEST time VK Nex gave in this run (a change to one
      // company while another was being read is not skipped), and not at all if a company was
      // left unfinished at the page cap.
      let asOf: string | null = null;
      let complete = true;
      let changed = 0;
      for (const companyId of companiesQuery()
        .all()
        .map((c) => c.id)) {
        let done = false;
        for (let page = 1; page <= 50; page++) {
          const p = await api.receiptStatus(companyId, since, page);
          changed += applyReceiptStatus(p.items);
          if (p.asOf && (!asOf || p.asOf < asOf)) asOf = p.asOf;
          if (!p.hasMore || p.items.length === 0) {
            done = true;
            break;
          }
        }
        if (!done) complete = false;
      }
      if (asOf && complete) setMeta('receiptStatusSince', asOf);
      sent = { ...sent, receiptStatus: { changed } };
    } catch (e) {
      sent = { ...sent, receiptStatusStoppedBy: e };
    }

    try {
      const today = todayISO();
      const ledgers = await downloadLedgers(ledgerCustomerIds(), today, {
        companyId: () => api.companyId(),
        fiscalYears: (companyId) => api.fiscalYears(companyId),
        ledgerPage: (q) => api.ledgerPage(q),
        onProgress: (done, total) => onStep('ledger', done, total),
      });
      saveLedgers(ledgers);
      return { ...sent, downloaded, ledger: { read: ledgers.read, skipped: ledgers.skipped } };
    } catch (e) {
      return { ...sent, downloaded, ledgerStoppedBy: e };
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

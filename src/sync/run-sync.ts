import Constants from 'expo-constants';

import { getMeta } from '@/db/meta';
import { companiesQuery, ensureCurrentCompany } from '@/features/company/company';
import { todayISO } from '@/lib/money';

import { getServerCredentials } from './credentials';
import { apiBaseUrl, type ServerAddress } from './server-address';
import { downloadCustomers } from './download-customers';
import { downloadItems } from './download-items';
import { downloadLedgers } from './download-ledgers';
import { downloadReceiptData } from './download-receipt-data';
import {
  getDeviceUid,
  getServerAddress,
  ledgerCustomerIds,
  markCustomerRefused,
  markCustomerSynced,
  markCustomerUpdated,
  markOrderRefused,
  markOrderSynced,
  markReceiptRefused,
  markReceiptSynced,
  markVisitRefused,
  markVisitSynced,
  pendingCustomers,
  pendingEdits,
  pendingOrders,
  pendingReceipts,
  pendingVisits,
  saveCustomerOptions,
  saveDownloadedCustomers,
  saveItemList,
  saveItemOptions,
  saveLedgers,
  saveReceiptData,
  type SavedDownload,
} from './sync-store';
import { updateCustomers, type UpdateOutcome } from './update-customers';
import { uploadCustomers, type UploadOutcome } from './upload-customers';
import { uploadOrders, type OrderOutcome } from './upload-orders';
import { uploadReceipts, type ReceiptOutcome } from './upload-receipts';
import { uploadVisits, type VisitOutcome } from './upload-visits';
import { createVkNexClient, type ApiError, type CustomerOptions } from './vk-nex-api';

export type SyncStep = 'signIn' | 'masters' | 'upload' | 'update' | 'orders' | 'visits' | 'receipts' | 'download' | 'items' | 'receiptData' | 'ledger';

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
  /** Tenders and open bills brought for receipts (companies read, bills). */
  receiptData?: { companies: number; bills: number };
  /** Why they did not come; the phone keeps what it had. */
  receiptDataStoppedBy?: unknown;
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
 * Not known yet: the phone's salesmen are test ones, and VK Nex sends no salesman list. Until it
 * does, check-ins wait on the phone with NO_SALESMAN (see docs/SYNC-API.md, Visits).
 */
const salesmanOf = (_userId: string): string | null => null;

/** "Test connection": is VK Nex answering at this address? Throws NetworkError / ApiError if not. */
export function testConnection(address: ServerAddress): Promise<void> {
  return clientFor(address).health();
}

let running: Promise<SyncReport> | null = null;

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
export function runSync(onStep: (step: SyncStep, done?: number, total?: number) => void): Promise<SyncReport> {
  running ??= (async (): Promise<SyncReport> => {
    const address = getServerAddress();
    if (!address) return { outcomes: [], updates: [], stoppedBy: new Error('NO_SERVER_ADDRESS'), stoppedAt: 'signIn' };
    const api = clientFor(address);

    let step: SyncStep = 'signIn';
    let options: CustomerOptions;
    try {
      onStep('signIn');
      await api.login();
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
        onProgress: (done, total) => onStep('receipts', done, total),
      });
      sent = { ...sent, receipts: rcts.outcomes, receiptsRefusedBy: rcts.refusedBy, receiptsRouteMissing: !!rcts.routeMissing };
      if (rcts.stoppedBy) return { ...sent, stoppedBy: rcts.stoppedBy, stoppedAt: 'receipts' };
    }

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
    try {
      onStep('items', 0, 0);
      const itemOptions = await api.itemOptions();
      saveItemOptions(itemOptions);
      ensureCurrentCompany();
      const got = await downloadItems(
        itemOptions.companies.map((c) => c.id),
        {
          listPage: (companyId, page) => api.itemListPage(companyId, page),
          onProgress: (done, total) => onStep('items', done, total),
        },
      );
      saveItemList(got);
      items = { companies: got.companyIds.length, items: got.items.length };
    } catch (e) {
      itemsStoppedBy = e;
    }
    sent = { ...sent, items, itemsStoppedBy };

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

import Constants from 'expo-constants';

import { getServerCredentials } from './credentials';
import { apiBaseUrl, type ServerAddress } from './server-address';
import { getServerAddress, markCustomerRefused, markCustomerSynced, pendingCustomers, saveCustomerOptions } from './sync-store';
import { uploadCustomers, type UploadOutcome } from './upload-customers';
import { createVkNexClient, type CustomerOptions } from './vk-nex-api';

export type SyncStep = 'signIn' | 'masters' | 'upload';

export interface SyncReport {
  outcomes: UploadOutcome[];
  /** Why the run stopped before the end (no address, server unreachable, sign-in refused …). */
  stoppedBy?: unknown;
  /** The step it stopped at. */
  stoppedAt?: SyncStep;
}

const appVersion = () => Constants.expoConfig?.version ?? '0.0.0';

const clientFor = (address: ServerAddress) =>
  createVkNexClient({ baseUrl: apiBaseUrl(address), appVersion: appVersion(), credentials: getServerCredentials });

/** "Test connection": is VK Nex answering at this address? Throws NetworkError / ApiError if not. */
export function testConnection(address: ServerAddress): Promise<void> {
  return clientFor(address).health();
}

let running: Promise<SyncReport> | null = null;

/**
 * Sync, started by the salesman: sign in to VK Nex, bring its areas, customer groups and price
 * levels, then send every customer added on the phone (POST /mobile/customers/create). Each one
 * is marked synced as soon as VK Nex has it. Only one run at a time; a second tap joins it.
 */
export function runSync(onStep: (step: SyncStep, done?: number, total?: number) => void): Promise<SyncReport> {
  running ??= (async (): Promise<SyncReport> => {
    const address = getServerAddress();
    if (!address) return { outcomes: [], stoppedBy: new Error('NO_SERVER_ADDRESS'), stoppedAt: 'signIn' };
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
      return { outcomes: [], stoppedBy: e, stoppedAt: step };
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
    return { outcomes: result.outcomes, stoppedBy: result.stoppedBy, stoppedAt: result.stoppedBy ? 'upload' : undefined };
  })().finally(() => {
    running = null;
  });
  return running;
}

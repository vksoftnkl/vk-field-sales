import Constants from 'expo-constants';

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

/** VK Nex listens on 3011 by default. The salesman can change it in Server settings. */
export const DEFAULT_SERVER_PORT = '3011';

/** VK Nex mounts every route under this prefix (global prefix + URI version). */
export const API_PREFIX = '/api/v1';

/** Sync tuning. Keep batches small so one bad record never blocks a big upload. */
export const SYNC = {
  pushBatchSize: 25,
  pullPageSize: 500,
  requestTimeoutMs: 20_000,
  /** "Test connection" should answer fast: the server PC is on the same LAN. */
  pingTimeoutMs: 5_000,
} as const;

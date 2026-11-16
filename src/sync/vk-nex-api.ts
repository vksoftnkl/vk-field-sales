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
export const isNetworkError = (e: unknown): e is NetworkError => (e as { kind?: unknown } | null)?.kind === 'network';

export interface ServerCredentials {
  loginName: string;
  password: string;
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

export function createVkNexClient(opts: VkNexClientOptions) {
  const doFetch: FetchLike = opts.fetch ?? (fetch as unknown as FetchLike);
  let token: string | null = null;

  async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown, auth = true): Promise<T> {
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

  async function login(): Promise<void> {
    const c = opts.credentials();
    if (!c) throw new ApiError(401, 'No VK Nex user to sign in with');
    const r = await call<{ access_token: string }>(
      'POST',
      '/auth/login',
      { usrLoginName: c.loginName, usrPassword: c.password, app_version: opts.appVersion, device_type: 'Mobile' },
      false,
    );
    token = r.access_token;
  }

  /** Signs in when needed, and once more if the token has run out mid-sync. */
  async function authed<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
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
    /** The whole customer: VK Nex's desktop payload, same field names as the phone's table. */
    getCustomer: (cusId: string) =>
      authed<Envelope<Record<string, unknown>>>('GET', `/mobile/customers/get?cusId=${encodeURIComponent(cusId)}`).then((r) => r.data),
  };
}

export type VkNexClient = ReturnType<typeof createVkNexClient>;

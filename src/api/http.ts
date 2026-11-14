import { getOrCreateDeviceId, getOrCreateDeviceKey } from '@/auth/device';
import { SYNC } from '@/config/env';
import { baseUrl, getServerAddress, type ServerAddress } from '@/config/server';

/**
 * The only HTTP client in the app. It is used by Sync (and "Test connection") — never by
 * screens. There are no user tokens: the server PC trusts an APPROVED device, identified
 * by X-Device-Id and proven by X-Device-Key.
 */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** 4xx (except 408/429) means the request itself is wrong — retrying won't help. */
  get isPermanent(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
  }
}

/** No response at all: server PC off, wrong IP, not on the office Wi-Fi, timeout. */
export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** The salesman hasn't entered the server PC's address yet. */
export class ServerNotSetError extends Error {
  constructor() {
    super('Server address is not set');
    this.name = 'ServerNotSetError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  timeoutMs?: number;
  /** Use this address instead of the saved one (Server settings → Test connection). */
  server?: ServerAddress;
  /** Send X-Device-Id / X-Device-Key. Default true. */
  device?: boolean;
}

function buildUrl(server: ServerAddress, path: string, query?: RequestOptions['query']): string {
  const url = `${baseUrl(server)}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const qs = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return qs ? `${url}?${qs}` : url;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const server = opts.server ?? getServerAddress();
  if (!server) throw new ServerNotSetError();

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.device !== false) {
    const [id, key] = await Promise.all([getOrCreateDeviceId(), getOrCreateDeviceKey()]);
    headers['X-Device-Id'] = id;
    headers['X-Device-Key'] = key;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? SYNC.requestTimeoutMs);
  let res: Response;
  try {
    res = await fetch(buildUrl(server, path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : 'Network request failed');
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  const data: unknown = text ? safeJson(text) : null;
  if (!res.ok) {
    // NestJS error shape: { statusCode, message: string | string[], error }
    const msg = extractMessage(data) ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, data);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function extractMessage(data: unknown): string | null {
  if (data && typeof data === 'object' && 'message' in data) {
    const m = (data as { message: unknown }).message;
    if (Array.isArray(m)) return m.join(', ');
    if (typeof m === 'string') return m;
  }
  return typeof data === 'string' && data.length < 300 ? data : null;
}

export const http = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
};

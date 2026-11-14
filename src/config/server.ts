import { getMeta, setMeta } from '@/db/meta';

import { API_PREFIX, DEFAULT_SERVER_PORT } from './env';

/**
 * Where the VK Nex server PC is. Entered once per phone in Server settings
 * (like the IP/port page of the old Qt salesman app) and kept in device_meta,
 * so it survives restarts and app updates.
 */
export interface ServerAddress {
  host: string;
  port: string;
}

export function getServerAddress(): ServerAddress | null {
  const host = getMeta('serverHost');
  if (!host) return null;
  return { host, port: getMeta('serverPort') ?? DEFAULT_SERVER_PORT };
}

export function saveServerAddress(addr: ServerAddress): void {
  setMeta('serverHost', addr.host.trim());
  setMeta('serverPort', addr.port.trim() || DEFAULT_SERVER_PORT);
}

/**
 * Accepts "192.168.0.10", "server-pc", "192.168.0.10:3011", "http://192.168.0.10:3011/api/v1" …
 * and splits it into host and (if typed) port.
 */
export function splitHostInput(input: string): { host: string; port: string | null } {
  const bare = input
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/[/?#].*$/, '');
  const m = /^(.*):(\d+)$/.exec(bare);
  return m ? { host: m[1]!, port: m[2]! } : { host: bare, port: null };
}

export function isValidPort(port: string): boolean {
  const n = Number(port);
  return /^\d+$/.test(port) && n >= 1 && n <= 65535;
}

/** Base URL for API calls, e.g. http://192.168.0.10:3011/api/v1 */
export function baseUrl(addr: ServerAddress): string {
  return `http://${addr.host}:${addr.port}${API_PREFIX}`;
}

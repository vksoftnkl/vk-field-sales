// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/** Where the VK Nex server PC is on the office LAN. Saved on the phone (device_meta). */
export interface ServerAddress {
  host: string;
  port: string;
}

export const DEFAULT_SERVER_PORT = '3012';
const API_PREFIX = '/api/v1';

/**
 * Accepts "192.168.1.10", "server-pc", "192.168.1.10:3012" or a pasted URL like
 * "http://192.168.1.10:3012/api/v1", and splits it into host and port (default 3012).
 * Null when nothing usable was typed.
 */
export function parseServerAddress(input: string): ServerAddress | null {
  const bare = input
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/[/?#].*$/, '');
  const m = /^(.*):(\d+)$/.exec(bare);
  const host = (m ? m[1]! : bare).trim();
  const port = m ? m[2]! : DEFAULT_SERVER_PORT;
  if (!host || /\s/.test(host) || !isValidPort(port)) return null;
  return { host, port };
}

export function isValidPort(port: string): boolean {
  const n = Number(port);
  return /^\d+$/.test(port) && n >= 1 && n <= 65535;
}

/** "192.168.1.10:3012", as shown in the address box. */
export const formatServerAddress = (a: ServerAddress): string => `${a.host}:${a.port}`;

/** Base URL of VK Nex's API, e.g. http://192.168.1.10:3012/api/v1 */
export const apiBaseUrl = (a: ServerAddress): string => `http://${a.host}:${a.port}${API_PREFIX}`;

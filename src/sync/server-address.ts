// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/**
 * Where the VK Nex server PC is on the office LAN. Saved on the phone (device_meta).
 * http = VK Nex's plain phone port (3012); https = its HTTPS port (3011), which the phone can
 * reach only when it trusts the server's certificate (see plugins/with-network-security.js).
 */
export interface ServerAddress {
  scheme: 'http' | 'https';
  host: string;
  port: string;
}

export const DEFAULT_SERVER_PORT = '3012';
/** VK Nex's HTTPS port: used when "https://" is typed without a port, and means https when no scheme is typed. */
export const DEFAULT_HTTPS_PORT = '3011';
const API_PREFIX = '/api/v1';

/**
 * Accepts "192.168.1.10", "server-pc", "192.168.1.10:3012" or a pasted URL like
 * "http://192.168.1.10:3012/api/v1" or "https://192.168.1.10:3011", and splits it into scheme,
 * host and port. The port defaults to 3012 for http and 3011 for https. With no scheme typed,
 * port 3011 means https (VK Nex answers only HTTPS there; plain HTTP gets no reply) and any other
 * port means http. Null when nothing usable was typed (or a scheme other than http/https).
 */
export function parseServerAddress(input: string): ServerAddress | null {
  const typed = input.trim();
  const s = /^([a-z][a-z0-9+.-]*):\/\//i.exec(typed);
  const typedScheme = s ? s[1]!.toLowerCase() : null;
  if (typedScheme !== null && typedScheme !== 'http' && typedScheme !== 'https') return null;
  const bare = typed.slice(s ? s[0].length : 0).replace(/[/?#].*$/, '');
  const m = /^(.*):(\d+)$/.exec(bare);
  const host = (m ? m[1]! : bare).trim();
  const port = m ? m[2]! : typedScheme === 'https' ? DEFAULT_HTTPS_PORT : DEFAULT_SERVER_PORT;
  const scheme = typedScheme ?? (port === DEFAULT_HTTPS_PORT ? 'https' : 'http');
  if (!host || /\s/.test(host) || !isValidPort(port)) return null;
  return { scheme, host, port };
}

export function isValidPort(port: string): boolean {
  const n = Number(port);
  return /^\d+$/.test(port) && n >= 1 && n <= 65535;
}

/** As shown in the address box: "192.168.1.10:3012" for http, "https://192.168.1.10:3011" for https. */
export const formatServerAddress = (a: ServerAddress): string =>
  `${a.scheme === 'https' ? 'https://' : ''}${a.host}:${a.port}`;

/** Base URL of VK Nex's API, e.g. http://192.168.1.10:3012/api/v1 or https://192.168.1.10:3011/api/v1 */
export const apiBaseUrl = (a: ServerAddress): string => `${a.scheme}://${a.host}:${a.port}${API_PREFIX}`;

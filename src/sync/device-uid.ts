// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/**
 * This phone's name on VK Nex: its fixed.device_master.dev_device_uid. Made once per install and
 * kept in device_meta. The office types it on VK Nex's Device List screen to register the phone,
 * so it is short and upper-case: 'VKSMAN-' + 12 hex digits (48 random bits).
 */
export function makeDeviceUid(random: () => number = Math.random): string {
  let hex = '';
  for (let i = 0; i < 12; i++) hex += Math.floor(random() * 16).toString(16);
  return `VKSMAN-${hex.toUpperCase()}`;
}

export const isDeviceUid = (s: string | null | undefined): s is string => !!s && /^VKSMAN-[0-9A-F]{12}$/.test(s);

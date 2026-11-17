// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import { financialYear } from '../../lib/date-range.ts';

/**
 * Bill numbers made on the phone: one series per phone, company and financial year, e.g.
 * '3F9A/2627/00001'. VK Nex numbers an offline counter's bills the same way (sb_bill_slno per
 * company / branch / year / counter). Until VK Nex gives the phone its own series code, the code
 * is the last 4 characters of the phone's device uid, which the office sees on its Device List.
 */

/** VK Nex's acc year for a date ('2026-11-17' → '2026-2027'), financial year Apr–Mar. */
export function accYearOf(iso: string): string {
  const start = financialYear(iso).from.slice(0, 4);
  return `${start}-${Number(start) + 1}`;
}

/** 'VKSMAN-0A1B2C3D3F9A' → '3F9A'. */
export const seriesCode = (deviceUid: string): string => deviceUid.replace(/^VKSMAN-/, '').slice(-4).toUpperCase();

/** '3F9A', '2026-2027', 1 → '3F9A/2627/00001'. */
export function billRefNo(series: string, accYear: string, slno: number): string {
  return `${series}/${accYear.slice(2, 4)}${accYear.slice(7, 9)}/${String(slno).padStart(5, '0')}`;
}

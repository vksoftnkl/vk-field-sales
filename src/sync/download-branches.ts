// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.
import type { BranchOption } from './vk-nex-api';

/** A branch row for the phone's branches table. */
export interface BranchRow {
  id: string;
  companyId: string;
  name: string;
  position: number;
  isDefault: boolean;
}

/**
 * Every company's branches, one GET per company, in VK Nex's order. A company may have none; a
 * failed read stops the run (the phone then keeps its old branches).
 */
export async function downloadBranches(companyIds: readonly string[], get: (companyId: string) => Promise<BranchOption[]>): Promise<{ companyIds: string[]; rows: BranchRow[] }> {
  const rows: BranchRow[] = [];
  const seen = new Set<string>();
  for (const companyId of companyIds) {
    const list = await get(companyId);
    list.forEach((b, i) => {
      const name = b.name?.trim();
      if (!b.id || !name || seen.has(b.id)) return;
      seen.add(b.id);
      rows.push({ id: b.id, companyId, name, position: i + 1, isDefault: b.isDefault === true });
    });
  }
  return { companyIds: [...companyIds], rows };
}

/**
 * The branches /mobile/items/options sends with the companies, as rows for the phone; null when
 * this VK Nex does not send them (older build), so Sync asks per company instead.
 */
export function branchesFromOptions(o: { companies: readonly { id: string }[]; branches?: readonly { id: string; name: string; companyId: string; isDefault: boolean }[] }): { companyIds: string[]; rows: BranchRow[] } | null {
  if (!Array.isArray(o.branches)) return null;
  const companyIds = o.companies.map((c) => c.id);
  const known = new Set(companyIds);
  const rows: BranchRow[] = [];
  const seen = new Set<string>();
  const position = new Map<string, number>();
  for (const b of o.branches) {
    const name = b.name?.trim();
    if (!b.id || !name || !known.has(b.companyId) || seen.has(b.id)) continue;
    seen.add(b.id);
    const next = (position.get(b.companyId) ?? 0) + 1;
    position.set(b.companyId, next);
    rows.push({ id: b.id, companyId: b.companyId, name, position: next, isDefault: b.isDefault === true });
  }
  return { companyIds, rows };
}

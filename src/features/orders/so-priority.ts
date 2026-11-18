// Pure TypeScript (no React Native imports) so `npm test` can run it in Node.

/** VK Nex's so_priority values (ck_so_priority), lowest first, as the Review dropdown lists them. */
export const SO_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;

export type SoPriority = (typeof SO_PRIORITIES)[number];

/** A new order's priority (VK Nex's default too). */
export const DEFAULT_PRIORITY: SoPriority = 'NORMAL';

/** Orders from the phone are always on credit (user's rule, 2026-11-18); VK Nex: CASH | CREDIT. */
export const SO_ORDER_TYPE = 'CREDIT';

const isPriority = (v: string): v is SoPriority => (SO_PRIORITIES as readonly string[]).includes(v);

/**
 * A saved so_priority as one of the four. Orders saved before the priority dropdown held only
 * 'URGENT' (the old Urgent delivery switch) or 'NORMAL', and orders from before migration 0015
 * hold null: anything that is not one of the four counts as NORMAL.
 */
export function toPriority(saved: string | null | undefined): SoPriority {
  const v = saved?.trim().toUpperCase() ?? '';
  return isPriority(v) ? v : DEFAULT_PRIORITY;
}

/** URGENT needs a remark saying why (as the old Urgent delivery switch did). */
export const priorityNeedsRemark = (p: SoPriority): boolean => p === 'URGENT';

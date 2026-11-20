import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { getMeta } from '@/db/meta';
import { companiesQuery, ensureCurrentCompany } from '@/features/company/company';

/**
 * Opens a Receipt for a shop (canvas 5b, step 1). VK Nex takes a receipt for one company: the one
 * picked in Switch company (side menu), as Sales and Return use it; there is no company step (user,
 * 2026-11-20). `companyId` is given only where the company is already fixed: a bill on the Ledger
 * (`billKey` opens that bill's adjustment on top of Dues; it can only be settled in its own
 * company) and the Visit, which keeps the company it started with.
 */
export function openReceipt(t: TFunction, customerId: string, companyId?: string | null, billKey?: string) {
  ensureCurrentCompany();
  const list = companiesQuery().all();
  const id = companyId && list.some((c) => c.id === companyId) ? companyId : getMeta('companyId');
  if (!id) return Alert.alert(t('order.noCompaniesTitle'), t('order.noCompaniesText'));
  router.push({ pathname: '/receipt/[customerId]', params: { customerId, companyId: id, ...(billKey ? { billKey } : {}) } });
}

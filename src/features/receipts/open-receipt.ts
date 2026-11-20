import { router } from 'expo-router';
import type { TFunction } from 'i18next';
import { Alert } from 'react-native';

import { companiesQuery } from '@/features/company/company';

/**
 * Opens a Receipt for a shop (canvas 5b, step 1). VK Nex takes a receipt for one company, so with
 * no company given and several on the phone, the salesman picks one first. `billKey` (from a bill
 * on the Ledger) opens that bill's adjustment on top of Dues.
 */
export function openReceipt(t: TFunction, customerId: string, companyId?: string | null, billKey?: string) {
  const list = companiesQuery().all();
  if (list.length === 0) return Alert.alert(t('order.noCompaniesTitle'), t('order.noCompaniesText'));
  const id = companyId && list.some((c) => c.id === companyId) ? companyId : list.length === 1 ? list[0]!.id : null;
  if (!id) return router.push({ pathname: '/receipt/company/[customerId]', params: { customerId } });
  router.push({ pathname: '/receipt/[customerId]', params: { customerId, companyId: id, ...(billKey ? { billKey } : {}) } });
}

// Offer details (mockup screen 4): everything VK Nex says about one offer, read from the phone's own copy.
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { Button } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { asOfText } from '@/features/orders/order-status';
import { colors, spacing } from '@/theme';

import { OfferDetails } from './offer-body';
import { offerIcon } from './offer-text';
import type { ItemOffer, OrderOffer } from './scheme-order';
import type { PromoScheme } from './scheme-types';

/**
 * `scheme` null = closed. `unit` is the unit of the line the offer was opened from ('' = the
 * offer's own). `companyName` goes beside the offer's code ("BISCUIT10+1 · Acme Foods").
 */
export function OfferSheet({
  scheme,
  offer,
  unit,
  syncedOn,
  companyName,
  onClose,
}: {
  scheme: PromoScheme | null;
  offer: ItemOffer | OrderOffer | undefined;
  unit: string;
  syncedOn: string | null;
  companyName?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const names = useDateNames();
  return (
    <BottomSheet
      visible={!!scheme}
      onClose={onClose}
      title={scheme?.name ?? ''}
      subtitle={[scheme?.code, companyName].filter(Boolean).join(' · ')}
      icon={scheme ? <Ionicons name={offerIcon(scheme)} size={22} color={colors.primary} /> : undefined}
      footer={<Button title={t('common.close')} onPress={onClose} style={st.close} />}
    >
      {scheme ? <OfferDetails scheme={scheme} offer={offer} unit={unit} companyName={companyName} /> : null}
      {syncedOn ? <Text style={st.note}>{t('offers.sheet.asOf', { when: asOfText(syncedOn, names, t('so.today')) })}</Text> : null}
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  note: { marginTop: spacing.xs, fontSize: 12, lineHeight: 17, color: colors.textMuted },
  close: { height: 52 },
});

// Offer details (mockup 4): everything VK Nex says about one offer, read from the phone's own copy.
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import { BottomSheet } from '@/components/sheet';
import { Button } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { asOfText } from '@/features/orders/order-status';
import { colors, font, spacing } from '@/theme';

import { OfferBody } from './offer-body';
import type { ItemOffer, OrderOffer } from './scheme-order';
import type { PromoScheme } from './scheme-types';

/** `scheme` null = closed. `unit` is the unit of the line the offer was opened from ('' = the offer's own). */
export function OfferSheet({
  scheme,
  offer,
  unit,
  syncedOn,
  onClose,
}: {
  scheme: PromoScheme | null;
  offer: ItemOffer | OrderOffer | undefined;
  unit: string;
  syncedOn: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const names = useDateNames();
  return (
    <BottomSheet
      visible={!!scheme}
      onClose={onClose}
      title={scheme?.name ?? ''}
      subtitle={scheme?.code}
      footer={<Button title={t('common.close')} variant="outline" onPress={onClose} />}
    >
      {scheme ? <OfferBody scheme={scheme} offer={offer} unit={unit} full /> : null}
      {syncedOn ? <Text style={st.note}>{t('offers.sheet.asOf', { when: asOfText(syncedOn, names, t('so.today')) })}</Text> : null}
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  note: { marginTop: spacing.sm, fontSize: font.sm - 1, lineHeight: 17, color: colors.textMuted },
});

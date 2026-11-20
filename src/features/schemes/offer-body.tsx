// What VK Nex says about one offer, in plain words: shared by the Offers card on Order item
// (compact) and the Offer details sheet (full).
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { useDateNames } from '@/components/use-date-names';
import { qtyText } from '@/features/orders/order-math';
import { formatDay } from '@/lib/date-range';
import { colors, font, radius, spacing } from '@/theme';

import { bandGives, bandRange, branchesText, daysText, hoursText, measureText, nudgeText, reasonText, schemeUnit, shopsText } from './offer-text';
import type { ItemOffer, OrderOffer } from './scheme-order';
import { PromoCode, type PromoScheme } from './scheme-types';

type Offer = ItemOffer | OrderOffer;

function Fact({ label, children }: { label: string; children: string }) {
  if (!children) return null;
  return (
    <View style={st.fact}>
      <Text style={st.factLabel}>{label}</Text>
      <Text style={st.factValue}>{children}</Text>
    </View>
  );
}

export function OfferBody({ scheme: s, offer, unit, full }: { scheme: PromoScheme; offer: Offer | undefined; unit: string; full?: boolean }) {
  const { t } = useTranslation();
  const names = useDateNames();
  const u = unit || schemeUnit(s);
  const bands = [...s.slabs].sort((a, b) => a.exceeds - b.exceeds);
  const days = daysText(s, names.weekdaysShort, t);
  const hours = hoursText(s, t);
  const own = s.allowWithManualDisc ? t('offers.ownOk') : t('offers.ownStops');
  const itemOffer = offer && 'countedItemIds' in offer ? offer : undefined;
  const counted =
    itemOffer && itemOffer.countedItemIds.length > 1
      ? t('offers.card.counted', { qty: measureText(s, offer!.measure, u) })
      : offer && offer.measure > 0
        ? t('offers.card.countedOne', { qty: measureText(s, offer.measure, u) })
        : '';
  const nudge = offer ? nudgeText(s, offer, u, t) : '';
  const why = offer && !offer.applied ? reasonText(offer.reason, s, offer, u, names, t) : '';
  const unitOnly = schemeUnit(s);
  const everyDay = !days && !hours;
  const dates = `${formatDay(s.startDate, names)} – ${formatDay(s.endDate, names)}`;
  const repeat = bands.find((b) => b.isRepeat);
  // "24 PCS → 2 PCS Glucose free": what the band in force gives for the quantity counted.
  const cur = offer?.applied ? s.slabs.find((b) => offer.bands.find((x) => x.current)?.exceeds === b.exceeds) : undefined;
  const onOrder = offer && cur ? `${measureText(s, offer.measure, u)} → ${bandGives(s, { ...cur, freeQty: cur.freeQty * Math.max(1, offer.payouts) }, u, t)}` : '';

  return (
    <View style={{ gap: spacing.sm }}>
      {counted ? <Text style={st.counted}>{counted}</Text> : null}

      {s.benefit !== PromoCode.DiscPerItem ? (
        <View style={st.bands}>
          {bands.map((b) => {
            const current = !!offer?.bands.find((x) => x.exceeds === b.exceeds && x.current);
            return (
              <View key={b.id} style={[st.band, current && st.bandOn]}>
                <Text style={[st.bandRange, current && st.bandTextOn]}>{bandRange(s, b, u, t)}</Text>
                <Text style={[st.bandGives, current && st.bandTextOn]}>{bandGives(s, b, u, t)}</Text>
                {current ? <Ionicons name="checkmark" size={16} color="#166534" /> : null}
              </View>
            );
          })}
        </View>
      ) : null}
      {repeat ? (
        <Text style={st.small}>
          {[
            t('offers.sheet.again', { each: measureText(s, repeat.each, u) }),
            repeat.maxRepeats > 0 ? t('offers.sheet.limit', { count: repeat.maxRepeats }) : t('offers.sheet.noLimit'),
          ].join(' · ')}
        </Text>
      ) : null}

      {onOrder && full ? <Fact label={t('offers.sheet.onOrder')}>{onOrder}</Fact> : null}
      {nudge ? (
        <View style={st.nudge}>
          <Ionicons name="trending-up" size={16} color="#92400E" />
          <Text style={st.nudgeText}>{nudge}</Text>
        </View>
      ) : null}
      {why ? <Text style={st.why}>{why}</Text> : null}

      <Fact label={t('offers.sheet.valid')}>
        {full ? `${dates}${everyDay ? `, ${t('offers.sheet.everyDay')}` : ''}${days ? `, ${days}` : ''}${hours ? `, ${hours}` : ''}` : dates}
      </Fact>
      {!full ? <Fact label=" ">{[days, hours].filter(Boolean).join(' · ')}</Fact> : null}
      {full ? (
        <Fact label={t('offers.sheet.countedIn')}>{unitOnly ? t('offers.sheet.unitOnly', { unit: unitOnly }) : t('offers.sheet.anyUnit')}</Fact>
      ) : unitOnly ? (
        <Fact label={t('offers.sheet.countedIn')}>{t('offers.card.onlyUnit', { unit: unitOnly })}</Fact>
      ) : null}
      <Fact label={t('offers.sheet.shops')}>{shopsText(s, t)}</Fact>
      <Fact label={t('offers.sheet.branches')}>{branchesText(s, t)}</Fact>
      {s.minQty > 0 ? <Fact label=" ">{t('offers.sheet.minQty', { qty: qtyText(s.minQty) })}</Fact> : null}
      {s.minBillAmount > 0 ? <Fact label=" ">{t('offers.sheet.minAmount', { amount: measureText({ ...s, applyOn: PromoCode.ItemAmount }, s.minBillAmount, '') })}</Fact> : null}
      {full ? <Fact label={t('offers.sheet.others')}>{s.stackMode === PromoCode.Exclusive ? t('offers.alone') : t('offers.stacks')}</Fact> : null}
      <Fact label={t('offers.sheet.own')}>{own}</Fact>
    </View>
  );
}

const st = StyleSheet.create({
  counted: { fontSize: font.sm, color: colors.textLabel },
  bands: { gap: 4 },
  band: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 36, borderRadius: radius.md, backgroundColor: colors.bg, paddingHorizontal: spacing.md },
  bandOn: { backgroundColor: '#DCFCE7' },
  bandRange: { width: 96, fontSize: 14, color: colors.textLabel },
  bandGives: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text },
  bandTextOn: { color: '#166534' },
  small: { fontSize: 12.5, color: colors.textMuted },
  nudge: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FEF3C7', borderRadius: radius.md, paddingVertical: 8, paddingHorizontal: spacing.md },
  nudgeText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: '#92400E' },
  why: { fontSize: 13.5, color: '#92400E' },
  fact: { flexDirection: 'row', gap: spacing.md },
  factLabel: { width: 84, fontSize: 13, color: colors.textMuted },
  factValue: { flex: 1, fontSize: 14, color: colors.text },
});

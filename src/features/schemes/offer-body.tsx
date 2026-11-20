// What VK Nex says about one offer, in plain words (mockup 2026-11-19): `OfferSection` is one offer
// on Order item's offers card (screen 2: bands as boxes, the nudge, the conditions as small icon
// notes), `OfferDetails` the Offer details sheet's body (screen 4: what it gives, what it does on
// this order, then the facts one per row).
import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useDateNames } from '@/components/use-date-names';
import { qtyText } from '@/features/orders/order-math';
import { formatDay } from '@/lib/date-range';
import { colors, font, offerColors, radius, spacing } from '@/theme';

import {
  bandBoxRange,
  bandGives,
  bandRange,
  bandShort,
  branchesText,
  chipText,
  daysText,
  giveText,
  groupText,
  hoursText,
  measureText,
  nudgeText,
  offerIcon,
  onOrderText,
  reasonText,
  repeatText,
  schemeUnit,
  shopsText,
} from './offer-text';
import type { ItemOffer, OrderOffer } from './scheme-order';
import { PromoCode, type PromoScheme } from './scheme-types';

type Offer = ItemOffer | OrderOffer;
type IconName = ComponentProps<typeof Ionicons>['name'];

/** Text with <b>…</b> parts in bold (the counted quantity). */
function Rich({ text, style, bold }: { text: string; style: object; bold: object }) {
  const parts = text.split(/<b>(.*?)<\/b>/);
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={bold}>
            {p}
          </Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

const sortedBands = (s: PromoScheme) => [...s.slabs].sort((a, b) => a.exceeds - b.exceeds);
const isCurrent = (offer: Offer | undefined, exceeds: number) => !!offer?.bands.find((x) => x.exceeds === exceeds && x.current);
/** Why it is not applied, unless the nudge already says how much more reaches a band. */
const whyNot = (s: PromoScheme, offer: Offer, u: string, nudge: string, names: ReturnType<typeof useDateNames>, t: ReturnType<typeof useTranslation>['t']): string =>
  offer.applied || (nudge && (offer.reason === 'noBand' || offer.reason === 'noPayout')) ? '' : reasonText(offer.reason, s, offer, u, names, t);

/** "Needs at least 10 in all" / "Needs at least ₹500 on the order": the offer's own minimums. */
function minimums(s: PromoScheme, t: ReturnType<typeof useTranslation>['t']): string[] {
  return [
    s.minQty > 0 ? t('offers.sheet.minQty', { qty: qtyText(s.minQty) }) : '',
    s.minBillAmount > 0 ? t('offers.sheet.minAmount', { amount: measureText({ ...s, applyOn: PromoCode.ItemAmount }, s.minBillAmount, '') }) : '',
  ].filter(Boolean);
}

/** One offer on Order item's card: name and chip (tap for the details), the count, bands, nudge, conditions. */
export function OfferSection({ scheme: s, offer, unit, onDetails }: { scheme: PromoScheme; offer: ItemOffer; unit: string; onDetails: () => void }) {
  const { t } = useTranslation();
  const names = useDateNames();
  const u = unit || schemeUnit(s);
  const group = groupText(s, t);
  const qty = measureText(s, offer.measure, u);
  const counted =
    offer.measure > 0
      ? group
        ? t('offers.card.countedTogether', { name: group, qty })
        : offer.countedItemIds.length > 1
          ? t('offers.card.counted', { qty })
          : t('offers.card.countedOne', { qty })
      : '';
  const nudge = nudgeText(s, offer, u, t);
  const why = whyNot(s, offer, u, nudge, names, t);
  const unitOnly = schemeUnit(s);
  const cond = (icon: IconName, text: string) => ({ icon, text });
  const conds = [
    cond('calendar-outline', `${formatDay(s.startDate, names)} – ${formatDay(s.endDate, names)}`),
    cond('today-outline', daysText(s, names.weekdaysShort, t)),
    cond('time-outline', hoursText(s, t)),
    cond('people-outline', shopsText(s, t)),
    cond('business-outline', branchesText(s, t)),
    cond('cube-outline', unitOnly ? t('offers.card.onlyUnit', { unit: unitOnly }) : ''),
    ...minimums(s, t).map((text) => cond('layers-outline', text)),
    s.allowWithManualDisc ? cond('checkmark-circle-outline', t('offers.ownOk')) : cond('alert-circle-outline', t('offers.ownStops')),
  ].filter((c) => c.text);
  const chip = chipText(s, offer, t);

  return (
    <View style={st.section}>
      <Pressable accessibilityRole="button" accessibilityHint={t('offers.badgeHint')} onPress={onDetails} style={({ pressed }) => [st.head, pressed && { opacity: 0.7 }]}>
        <Ionicons name={offerIcon(s)} size={18} color={colors.primary} />
        <Text style={st.name}>{s.name}</Text>
        <View style={[st.chip, offer.applied ? st.chipOn : st.chipOff]}>
          <Text style={[st.chipText, offer.applied && { color: offerColors.okText }]}>{chip}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
      </Pressable>
      {counted ? <Rich text={counted} style={st.counted} bold={st.countedBold} /> : null}

      {s.benefit !== PromoCode.DiscPerItem && s.slabs.length > 0 ? (
        <View style={st.boxes}>
          {sortedBands(s).map((b) => {
            const on = isCurrent(offer, b.exceeds);
            return (
              <View key={b.id} style={[st.box, on && st.boxOn]} accessible accessibilityLabel={`${bandRange(s, b, u, t)}: ${bandGives(s, b, u, t)}`} accessibilityState={{ selected: on }}>
                <Text style={st.boxRange} numberOfLines={1}>
                  {bandBoxRange(s, b, u, t)}
                </Text>
                <Text style={st.boxGives} numberOfLines={1}>
                  {bandShort(s, b, u, t)}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {nudge ? (
        <View style={st.nudge}>
          <Ionicons name="trending-up" size={15} color={offerColors.warn} />
          <Text style={st.nudgeText}>{nudge}</Text>
        </View>
      ) : null}
      {why ? <Text style={st.why}>{why}</Text> : null}

      <View style={st.conds}>
        {conds.map((c) => (
          <View key={c.icon + c.text} style={st.cond}>
            <Ionicons name={c.icon} size={13} color={colors.textMuted} />
            <Text style={st.condText}>{c.text}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function Fact({ label, children }: { label: string; children: string }) {
  if (!children) return null;
  return (
    <View style={st.kv}>
      <Text style={st.k}>{label}</Text>
      <Text style={st.v}>{children}</Text>
    </View>
  );
}

/** The Offer details sheet's body. `companyName` turns "All branches" into "All branches of Acme Foods". */
export function OfferDetails({ scheme: s, offer, unit, companyName }: { scheme: PromoScheme; offer: Offer | undefined; unit: string; companyName?: string }) {
  const { t } = useTranslation();
  const names = useDateNames();
  const u = unit || schemeUnit(s);
  const bands = sortedBands(s);
  const days = daysText(s, names.weekdaysShort, t);
  const hours = hoursText(s, t);
  const unitOnly = schemeUnit(s);
  const dates = `${formatDay(s.startDate, names)} – ${formatDay(s.endDate, names)}`;
  const valid = `${dates}${!days && !hours ? `, ${t('offers.sheet.everyDay')}` : ''}${days ? `, ${days}` : ''}${hours ? `, ${hours}` : ''}`;
  const allBranches = s.branchScope !== PromoCode.ScopeList && !s.branchId;
  const branches = allBranches && companyName ? t('offers.allBranchesOf', { company: companyName }) : branchesText(s, t);
  const notes = [repeatText(s, u, t), ...minimums(s, t)].filter(Boolean).join(' · ');

  const onOrder = offer ? onOrderText(s, offer, u, t) : '';
  const nudge = offer ? nudgeText(s, offer, u, t) : '';
  const why = offer ? whyNot(s, offer, u, nudge, names, t) : '';
  const ok = !!offer?.applied;

  return (
    <View style={{ gap: spacing.sm + 2 }}>
      <View style={st.give}>
        <Ionicons name={s.benefit === PromoCode.FreeItem ? 'gift' : 'pricetag'} size={24} color={colors.primary} />
        <View style={{ flex: 1, gap: 3 }}>
          {s.benefit === PromoCode.DiscPerItem || !bands[0] ? (
            <Text style={st.giveText}>{t('offers.gives.itemRates')}</Text>
          ) : bands.length === 1 ? (
            <Text style={st.giveText}>{giveText(s, bands[0], u, t)}</Text>
          ) : (
            bands.map((b) => {
              const on = isCurrent(offer, b.exceeds);
              return (
                <View key={b.id} style={st.bandRow} accessibilityState={{ selected: on }}>
                  <Text style={[st.bandText, on && st.bandOn]}>{`${bandRange(s, b, u, t)} → ${bandGives(s, b, u, t)}`}</Text>
                  {on ? <Ionicons name="checkmark" size={16} color={offerColors.okText} /> : null}
                </View>
              );
            })
          )}
          {notes ? <Text style={st.giveNote}>{notes}</Text> : null}
        </View>
      </View>

      {onOrder || nudge || why ? (
        <View style={[st.onOrder, ok ? st.onOrderOk : st.onOrderWarn]}>
          {onOrder ? <Text style={st.okText}>{t('offers.sheet.onOrderLine', { what: onOrder })}</Text> : null}
          {why ? <Text style={st.warnText}>{why}</Text> : null}
          {nudge ? <Text style={st.warnText}>{nudge}</Text> : null}
        </View>
      ) : null}

      <View>
        <Fact label={t('offers.sheet.valid')}>{valid}</Fact>
        <Fact label={t('offers.sheet.countedIn')}>{unitOnly ? t('offers.sheet.unitOnly', { unit: unitOnly }) : t('offers.sheet.anyUnit')}</Fact>
        <Fact label={t('offers.sheet.shops')}>{shopsText(s, t)}</Fact>
        <Fact label={t('offers.sheet.branches')}>{branches}</Fact>
        <Fact label={t('offers.sheet.others')}>{s.stackMode === PromoCode.Exclusive ? t('offers.alone') : t('offers.stacks')}</Fact>
        <Fact label={t('offers.sheet.own')}>{s.allowWithManualDisc ? t('offers.ownOk') : t('offers.ownStops')}</Fact>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  // Order item card section
  section: { gap: spacing.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  name: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.text },
  chip: { borderRadius: radius.sm + 2, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  chipOn: { backgroundColor: offerColors.okBg, borderColor: offerColors.okBorder },
  chipOff: { backgroundColor: colors.bg, borderColor: colors.border },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textLabel },
  counted: { fontSize: font.sm, color: colors.textMuted },
  countedBold: { fontWeight: '700', color: colors.text },
  boxes: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  box: {
    flexGrow: 1,
    flexBasis: '30%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm + 2,
    backgroundColor: offerColors.slabBg,
    paddingVertical: spacing.xs,
    paddingHorizontal: 6,
  },
  // 0.5 px thicker border, 0.5 px less padding: the box doesn't grow when it is the one in force.
  boxOn: { borderWidth: 1.5, borderColor: colors.success, backgroundColor: offerColors.okBg, paddingVertical: spacing.xs - 0.5, paddingHorizontal: 5.5 },
  boxRange: { fontSize: 11.5, color: colors.textLabel },
  boxGives: { fontSize: 14, fontWeight: '700', color: colors.text },
  nudge: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nudgeText: { flex: 1, fontSize: font.sm, fontWeight: '600', color: offerColors.warn },
  why: { fontSize: font.sm, fontWeight: '600', color: offerColors.warn },
  conds: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: spacing.xs },
  cond: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, maxWidth: '100%' },
  condText: { flexShrink: 1, fontSize: 12, color: colors.textMuted },

  // Offer details sheet
  give: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.primarySoft, borderRadius: radius.md + 2, paddingVertical: 11, paddingHorizontal: spacing.md },
  giveText: { fontSize: 14.5, lineHeight: 20, fontWeight: '700', color: colors.text },
  giveNote: { fontSize: 12.5, color: colors.textMuted },
  bandRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bandText: { flexShrink: 1, fontSize: 14, color: colors.text },
  bandOn: { fontWeight: '700', color: offerColors.okText },
  onOrder: { borderWidth: 1, borderRadius: radius.md + 2, paddingVertical: 9, paddingHorizontal: spacing.md, gap: 2 },
  onOrderOk: { backgroundColor: offerColors.okBg, borderColor: offerColors.okBorder },
  onOrderWarn: { backgroundColor: offerColors.warnBg, borderColor: offerColors.warnBorder },
  okText: { fontSize: 13.5, fontWeight: '600', color: offerColors.okText },
  warnText: { fontSize: 13.5, fontWeight: '600', color: offerColors.warn },
  kv: { flexDirection: 'row', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.border },
  k: { width: 104, fontSize: font.sm, color: colors.textMuted },
  v: { flex: 1, fontSize: font.sm, fontWeight: '500', color: colors.text },
});

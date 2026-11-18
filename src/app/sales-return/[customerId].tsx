import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams, usePreventRemove } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui';
import { ScreenHeader } from '@/components/screen-header';
import { addressLine } from '@/features/customers/customer-list';
import { itemName } from '@/features/orders/order-items';
import { qtyText, toPaise } from '@/features/orders/order-math';
import { customerName } from '@/features/orders/queries';
import { returnCleared, returnLineRemoved, returnStarted } from '@/features/returns/return-draft';
import { returnTotals, type ReturnLine } from '@/features/returns/return-math';
import { returnCustomerQuery, saveReturn } from '@/features/returns/queries';
import { saleCustomerQuery } from '@/features/sales/queries';
import type { SaleLineAmounts } from '@/features/sales/sale-math';
import { formatAmount } from '@/lib/money';
import { store, useAppDispatch, useAppSelector } from '@/store';
import { getDeviceUid } from '@/sync/sync-store';
import { colors, font, radius, spacing } from '@/theme';

/** Reason chips: damaged red, expired amber. */
const REASON_COLORS = {
  DAMAGED: { bg: '#FEE2E2', fg: '#991B1B' },
  EXPIRED: { bg: '#FEF3C7', fg: '#92400E' },
} as const;

/**
 * Sales return (the Qt app's ReturnEntry.qml), opened by Return on Customer detail: the shop
 * (Change picks another), the products coming back with why, and Create credit note, which saves
 * the return on the phone as pending. The return is for the company picked on the phone, as bills are.
 */
export default function SalesReturnScreen() {
  const { customerId: openedFor, companyId } = useLocalSearchParams<{ customerId: string; companyId: string }>();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.returnDraft);
  const userId = useAppSelector((st) => st.session.session?.userId ?? '');

  useEffect(() => {
    dispatch(returnStarted({ customerId: openedFor, companyId }));
  }, [dispatch, openedFor, companyId]);

  const customerId = draft.customerId ?? openedFor;
  const { data: found } = useLiveQuery(returnCustomerQuery(customerId), [customerId]);
  const c = found[0];
  const name = c ? customerName(c) : '';
  const totals = returnTotals(draft.lines);
  const [saving, setSaving] = useState(false);
  const saved = useRef(false);

  // Leaving with products entered asks first. Create credit note clears the return before it
  // closes this screen, so it is not asked then.
  usePreventRemove(draft.lines.length > 0, ({ repeat }) => {
    Alert.alert(t('salesReturn.discardTitle'), t('salesReturn.discardText', { name }), [
      { text: t('order.keep'), style: 'cancel' },
      {
        text: t('order.discard'),
        style: 'destructive',
        onPress: () => {
          dispatch(returnCleared());
          repeat();
        },
      },
    ]);
  });

  const create = () => {
    const d = store.getState().returnDraft;
    if (saved.current || !d.customerId || !d.companyId || d.lines.length === 0) return;
    const shop = saleCustomerQuery(d.customerId).get();
    if (!shop) return Alert.alert(t('common.error'));
    setSaving(true);
    try {
      const { refNo } = saveReturn({ companyId: d.companyId, lines: d.lines }, shop, userId, getDeviceUid());
      saved.current = true;
      // Cleared first, and the screen closed a frame later, once it has drawn itself without
      // products: then it lets itself be closed without asking to discard.
      dispatch(returnCleared());
      requestAnimationFrame(() => {
        router.back();
        Alert.alert(t('salesReturn.savedTitle'), t('salesReturn.savedText', { no: refNo, name: customerName(shop) }));
      });
    } catch {
      setSaving(false);
      Alert.alert(t('common.error'));
    }
  };

  const place = c ? [addressLine(c), c.beatName].filter(Boolean).join(' · ') : '';
  const extras = [
    totals.taxPaise > 0 ? t('salesReturn.taxNote', { amount: formatAmount(totals.taxPaise) }) : null,
    totals.roundOffPaise !== 0 ? t('salesReturn.roundOff', { amount: formatAmount(totals.roundOffPaise) }) : null,
  ].filter(Boolean);

  return (
    <View style={st.root}>
      <ScreenHeader title={t('salesReturn.title')} subtitle={t('salesReturn.subtitle')} backLabel={t('salesReturn.back')} />

      <ScrollView contentContainerStyle={st.body}>
        <View style={st.customer}>
          <View style={st.customerText}>
            <Text style={st.small}>{t('salesReturn.customer')}</Text>
            <Text style={st.customerName}>{name}</Text>
            {place ? <Text style={st.small}>{place}</Text> : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('salesReturn.changeCustomer')}
            onPress={() => router.push('/sales-return/customer')}
            style={({ pressed }) => [st.outlineBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={st.outlineText}>{t('salesReturn.change')}</Text>
          </Pressable>
        </View>

        <View style={st.productsHead}>
          <Text style={st.h2} accessibilityRole="header">
            {t('salesReturn.products')}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/sales-return/products')}
            style={({ pressed }) => [st.addBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="add" size={18} color={colors.onPrimary} />
            <Text style={st.addText}>{t('salesReturn.addProduct')}</Text>
          </Pressable>
        </View>

        {draft.lines.length === 0 ? <Text style={st.empty}>{t('salesReturn.empty')}</Text> : null}
        {draft.lines.map((l, i) => (
          <ReturnRow
            key={l.key}
            line={l}
            amounts={totals.lines[i]!}
            language={i18n.language}
            onOpen={() => router.push({ pathname: '/sales-return/item', params: { lineKey: l.key } })}
            onRemove={() => dispatch(returnLineRemoved(l.key))}
          />
        ))}
      </ScrollView>

      <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={st.totalRow} accessible accessibilityLabel={`${t('salesReturn.total')}: ${formatAmount(totals.totalPaise)}`}>
          <Text style={st.totalLabel}>{t('salesReturn.total')}</Text>
          <Text style={st.totalValue}>{formatAmount(totals.totalPaise)}</Text>
        </View>
        {extras.length ? <Text style={st.extras}>{extras.join(' · ')}</Text> : null}
        <Button title={t('salesReturn.create')} onPress={create} loading={saving} disabled={totals.items === 0 || !c} style={{ height: 52 }} />
        <Text style={st.note}>{t('salesReturn.keptNote')}</Text>
      </View>
    </View>
  );
}

function ReturnRow({
  line,
  amounts,
  language,
  onOpen,
  onRemove,
}: {
  line: ReturnLine;
  amounts: SaleLineAmounts;
  language: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const name = itemName({ itemNameEn: line.name, itemNameTa: line.nameTa }, language);
  const mrp = toPaise(line.mrp);
  const rate = t('order.rate', { unit: line.unitName, price: formatAmount(toPaise(line.price) ?? 0) }) + (mrp ? t('sale.lineMrp', { mrp: formatAmount(mrp) }) : '');
  const batch = [
    line.batchNo.trim() ? t('salesReturn.batch', { no: line.batchNo.trim().toUpperCase() }) : null,
    line.expiryDate.trim() ? t('salesReturn.exp', { date: line.expiryDate.trim() }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const chip = REASON_COLORS[line.reason];
  return (
    <View style={st.line}>
      <Pressable accessibilityRole="button" accessibilityHint={t('salesReturn.itemTitle')} onPress={onOpen} style={st.lineMain}>
        <Text style={st.lineName}>{name}</Text>
        <Text style={st.lineRate}>{rate}</Text>
        <View style={st.lineTags}>
          <Text style={[st.reason, { backgroundColor: chip.bg, color: chip.fg }]}>{t(`salesReturn.reasons.${line.reason}`)}</Text>
          {batch ? <Text style={st.lineRate}>{batch}</Text> : null}
        </View>
      </Pressable>
      <View style={st.lineRight}>
        <Text style={st.lineQty}>{t('salesReturn.qty', { qty: qtyText(amounts.qty) })}</Text>
        <Text style={st.lineAmount}>{formatAmount(amounts.netPaise)}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={t('salesReturn.removeLine', { name })} onPress={onRemove} hitSlop={4} style={st.delete}>
        <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.md },
  customer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    paddingLeft: spacing.md + 2,
  },
  customerText: { flex: 1, gap: 3, minWidth: 0 },
  small: { fontSize: 12, color: colors.textMuted },
  customerName: { fontSize: 16, fontWeight: '600', color: colors.text },
  outlineBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    justifyContent: 'center',
  },
  outlineText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  productsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  h2: { fontSize: font.md, fontWeight: '600', color: colors.text },
  addBtn: {
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  addText: { fontSize: 14, fontWeight: '600', color: colors.onPrimary },
  empty: { fontSize: font.md, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md + 2,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md + 2,
    paddingRight: 6,
  },
  lineMain: { flex: 1, gap: 4, minWidth: 0 },
  lineName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  lineRate: { fontSize: 12, color: colors.textMuted },
  lineTags: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  reason: { fontSize: 12, fontWeight: '600', paddingHorizontal: spacing.sm, paddingVertical: 1, borderRadius: radius.sm, overflow: 'hidden' },
  lineRight: { alignItems: 'flex-end', gap: 2 },
  lineQty: { fontSize: font.sm, color: colors.textMuted },
  lineAmount: { fontSize: font.md, fontWeight: '600', color: colors.text },
  delete: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  footer: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: 10,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  totalLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  totalValue: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  extras: { fontSize: 12, color: colors.textMuted, marginTop: -6 },
  note: { fontSize: 12, color: colors.textMuted, textAlign: 'center' },
});

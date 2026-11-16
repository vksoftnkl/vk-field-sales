import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { Button, TextField } from '@/components/ui';
import { orderCleared, qtyTyped, remarksTyped, vehicleTyped, type DraftLine } from '@/features/orders/order-draft';
import { itemName } from '@/features/orders/order-items';
import { decimalInput, lineAmounts, num, orderTotals, qtyText, toPaise } from '@/features/orders/order-math';
import { companyQuery, customerName, orderCustomerQuery, REMARKS_MAX, saveOrder } from '@/features/orders/queries';
import { formatAmount } from '@/lib/money';
import { store, useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Order summary (the Qt app's OrderCheckout.qml): the lines with their quantities (still
 * changeable), items, total qty, cooly, freight and the order total, vehicle number and remarks.
 * Save order asks first, then keeps the order on the phone for the next Sync. Printing is not
 * back in the app yet.
 */
export default function OrderSummaryScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.orderDraft);
  const userId = useAppSelector((st) => st.session.session?.userId ?? '');
  const { data: found } = useLiveQuery(orderCustomerQuery(draft.customerId ?? ''), [draft.customerId]);
  const { data: company } = useLiveQuery(companyQuery(draft.companyId ?? ''), [draft.companyId]);
  const c = found[0];
  const totals = orderTotals(draft.lines);
  const [saving, setSaving] = useState(false);
  const saved = useRef(false);

  const save = () => {
    if (saved.current || !c || !draft.customerId || !draft.companyId || totals.items === 0) return;
    Alert.alert(t('order.saveTitle'), t('order.saveText', { name: customerName(c), total: formatAmount(totals.totalPaise) }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('order.saveOrder'),
        onPress: () => {
          const d = store.getState().orderDraft;
          if (saved.current || !d.customerId || !d.companyId) return;
          setSaving(true);
          try {
            saveOrder({ customerId: d.customerId, companyId: d.companyId, lines: d.lines, vehicleNo: d.vehicleNo, remarks: d.remarks }, c, userId);
            saved.current = true;
            const customerId = d.customerId;
            // Cleared first, and the screens closed a frame later, once Order entry has drawn
            // itself without items: then it lets itself be closed without asking to discard.
            dispatch(orderCleared());
            requestAnimationFrame(() => {
              router.dismissTo({ pathname: '/customer/[id]', params: { id: customerId } });
              Alert.alert(t('order.savedTitle'), t('order.savedText'));
            });
          } catch {
            setSaving(false);
            Alert.alert(t('common.error'));
          }
        },
      },
    ]);
  };

  const subtitle = [c ? customerName(c) : '', company[0]?.name ?? ''].filter(Boolean).join(' · ');

  return (
    <View style={st.root}>
      <ScreenHeader title={t('order.summaryTitle')} subtitle={subtitle} backLabel={t('order.back')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          {draft.lines.length === 0 ? <Text style={st.empty}>{t('order.empty')}</Text> : null}
          {draft.lines.map((l) => (
            <SummaryLine
              key={l.iucId}
              line={l}
              language={i18n.language}
              onQty={(qty) => dispatch(qtyTyped({ seed: l, qty: decimalInput(qty, 3) }))}
              onOpen={() => router.push({ pathname: '/order/item', params: { iucId: l.iucId } })}
            />
          ))}

          <View style={st.totals}>
            <TotalRow label={t('order.items')} value={String(totals.items)} />
            <TotalRow label={t('order.totalQty')} value={qtyText(totals.qty)} />
            {totals.discPaise > 0 ? <TotalRow label={t('order.discountLabel')} value={`−${formatAmount(totals.discPaise)}`} /> : null}
            {totals.freightPaise > 0 ? <TotalRow label={t('order.freightLabel')} value={formatAmount(totals.freightPaise)} /> : null}
            {totals.loadPaise > 0 ? <TotalRow label={t('order.coolyLabel')} value={formatAmount(totals.loadPaise)} /> : null}
            <View style={st.grand} accessible accessibilityLabel={`${t('order.orderTotal')}: ${formatAmount(totals.totalPaise)}`}>
              <Text style={st.grandLabel}>{t('order.orderTotal')}</Text>
              <Text style={st.grandValue}>{formatAmount(totals.totalPaise)}</Text>
            </View>
          </View>

          <TextField
            label={t('order.vehicle')}
            value={draft.vehicleNo}
            onChangeText={(v) => dispatch(vehicleTyped(v.toUpperCase()))}
            placeholder="TN 28 __ ____"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={15}
          />
          <TextField
            label={t('order.remarks')}
            value={draft.remarks}
            onChangeText={(v) => dispatch(remarksTyped(v))}
            placeholder={t('order.optional')}
            multiline
            maxLength={REMARKS_MAX}
            style={st.remarks}
          />
        </ScrollView>
        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Button title={t('order.saveOrder')} onPress={save} loading={saving} disabled={totals.items === 0} style={{ height: 52 }} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function SummaryLine({ line, language, onQty, onOpen }: { line: DraftLine; language: string; onQty: (qty: string) => void; onOpen: () => void }) {
  const { t } = useTranslation();
  const a = lineAmounts(line);
  const name = itemName({ itemNameEn: line.name, itemNameTa: line.nameTa }, language);
  const mrp = toPaise(line.mrp);
  const meta =
    t('order.lineMeta', { unit: line.unitName, price: formatAmount(toPaise(line.price) ?? 0) }) +
    (mrp ? t('order.lineMrp', { mrp: formatAmount(mrp) }) : '') +
    (num(line.discPerc) > 0 ? t('order.lineDisc', { perc: line.discPerc }) : '') +
    (num(line.discPerUnit) > 0 ? t('order.lineDiscRs', { rs: line.discPerUnit }) : '') +
    (num(line.loadPerUnit) > 0 ? ` · ${t('order.cooly', { amount: formatAmount(toPaise(line.loadPerUnit) ?? 0) })}` : '') +
    (num(line.freightPerUnit) > 0 ? ` · ${t('order.freight', { amount: formatAmount(toPaise(line.freightPerUnit) ?? 0) })}` : '');
  return (
    <View style={[st.line, a.qty <= 0 && { opacity: 0.6 }]}>
      <Pressable accessibilityRole="button" accessibilityHint={t('order.itemTitle')} onPress={onOpen} style={st.lineMain}>
        <Text style={st.lineName}>{name}</Text>
        <Text style={st.lineMeta}>{meta}</Text>
        <Text style={st.lineAmount}>{formatAmount(a.netPaise)}</Text>
      </Pressable>
      <TextInput
        value={line.qty}
        onChangeText={onQty}
        placeholder="0"
        placeholderTextColor={colors.textMuted}
        keyboardType="decimal-pad"
        accessibilityLabel={t('order.qtyFor', { name })}
        selectTextOnFocus
        maxLength={9}
        style={st.qty}
      />
    </View>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.totalRow}>
      <Text style={st.totalLabel}>{label}</Text>
      <Text style={st.totalValue}>{value}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: spacing.sm },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xl },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md + 2,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md + 2,
    paddingRight: spacing.md,
  },
  lineMain: { flex: 1, gap: 4, minWidth: 0 },
  lineName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  lineMeta: { fontSize: 12, color: colors.textMuted },
  lineAmount: { fontSize: 14, fontWeight: '600', color: colors.text },
  qty: {
    width: 64,
    height: 48,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md,
    textAlign: 'center',
    fontSize: font.lg,
    fontWeight: '600',
    color: colors.text,
    backgroundColor: colors.surface,
    padding: 0,
  },
  totals: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    gap: 6,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: 14, color: colors.textMuted },
  totalValue: { fontSize: 14, color: colors.text },
  grand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', borderTopWidth: 1, borderTopColor: '#F1EDE4', paddingTop: spacing.sm, marginTop: 2 },
  grandLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  grandValue: { fontSize: font.xl, fontWeight: '700', color: colors.text },
  remarks: { minHeight: 72, textAlignVertical: 'top', paddingTop: spacing.md },
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});

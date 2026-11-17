import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { Button, TextField } from '@/components/ui';
import { customerDetailQuery } from '@/features/customers/queries';
import { itemName } from '@/features/orders/order-items';
import { decimalInput, num, paiseText, qtyText, toPaise } from '@/features/orders/order-math';
import { customerName } from '@/features/orders/queries';
import {
  billDiscAmountTyped,
  billDiscPercTyped,
  billRemarksTyped,
  saleCleared,
  saleLineRemoved,
  saleQtyTyped,
  type SaleLine,
} from '@/features/sales/sale-draft';
import { billProblem, billTotals, overStock, type SaleLineAmounts } from '@/features/sales/sale-math';
import { BILL_REMARKS_MAX, nextBillNo, saleCustomerQuery, saveBill } from '@/features/sales/queries';
import { formatAmount } from '@/lib/money';
import { store, useAppDispatch, useAppSelector } from '@/store';
import { getDeviceUid } from '@/sync/sync-store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Bill (the Qt app's SalesCheckout.qml): the lines with their quantities (still changeable), the
 * subtotal before tax, a bill discount (% or ₹), GST, round off and the total, and remarks. Every
 * bill is a credit bill (the Qt app's payment step was never finished). Save asks first, showing
 * the number the bill gets, then keeps it on the phone and marks the shop Billed.
 */
export default function BillScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.saleDraft);
  const userId = useAppSelector((st) => st.session.session?.userId ?? '');
  const { data: found } = useLiveQuery(saleCustomerQuery(draft.customerId ?? ''), [draft.customerId]);
  const { data: detail } = useLiveQuery(customerDetailQuery(draft.customerId ?? ''), [draft.customerId]);
  const c = found[0];
  const discount = { perc: draft.discPerc, amount: draft.discAmount };
  const totals = billTotals(draft.lines, discount);
  const problem = billProblem(discount, totals);
  const short = useMemo(() => overStock(draft.lines), [draft.lines]);
  const [confirm, setConfirm] = useState<{ refNo: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const saved = useRef(false);

  const closeConfirm = () => {
    if (!saving) setConfirm(null);
  };

  const askSave = () => {
    if (saved.current || !c || !draft.companyId || totals.items === 0) return;
    if (short.size > 0) return Alert.alert(t('sale.fixTitle'), t('sale.fixStock'));
    if (problem) return Alert.alert(t('sale.fixTitle'), t(`sale.billProblems.${problem}`));
    setConfirm({ refNo: nextBillNo(draft.companyId, getDeviceUid()).refNo });
  };

  const doSave = () => {
    const d = store.getState().saleDraft;
    if (saved.current || !c || !d.customerId || !d.companyId) return;
    setSaving(true);
    try {
      const { refNo } = saveBill(
        { customerId: d.customerId, companyId: d.companyId, lines: d.lines, discPerc: d.discPerc, discAmount: d.discAmount, remarks: d.remarks },
        c,
        userId,
        getDeviceUid(),
      );
      saved.current = true;
      const customerId = d.customerId;
      setConfirm(null);
      // Cleared first, and the screens closed a frame later, once Select items has drawn itself
      // without items: then it lets itself be closed without asking to discard.
      dispatch(saleCleared());
      requestAnimationFrame(() => {
        router.dismissTo({ pathname: '/customer/[id]', params: { id: customerId } });
        Alert.alert(t('sale.savedTitle'), t('sale.savedText', { no: refNo }));
      });
    } catch {
      setSaving(false);
      setConfirm(null);
      Alert.alert(t('common.error'));
    }
  };

  const due = detail[0]?.outstandingPaise;
  const subtitle = [c ? customerName(c) : '', due ? t('sale.due', { amount: formatAmount(due) }) : null].filter(Boolean).join(' · ');
  // With a % typed, the rupee box shows what it comes to (the Qt app did the same).
  const discAmountShown = draft.discPerc.trim() !== '' ? (totals.billDiscPaise > 0 ? paiseText(totals.billDiscPaise) : '') : draft.discAmount;

  return (
    <View style={st.root}>
      <ScreenHeader title={t('sale.billTitle')} subtitle={subtitle} backLabel={t('sale.back')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          {draft.lines.length === 0 ? <Text style={st.empty}>{t('sale.empty')}</Text> : null}
          {draft.lines.map((l, i) => (
            <BillLine
              key={l.iucId}
              line={l}
              amounts={totals.lines[i]!}
              isShort={short.has(l.iucId)}
              language={i18n.language}
              onQty={(qty) => dispatch(saleQtyTyped({ seed: l, qty: decimalInput(qty, 3) }))}
              onOpen={() => router.push({ pathname: '/sales/item', params: { iucId: l.iucId } })}
              onRemove={() => dispatch(saleLineRemoved(l.iucId))}
            />
          ))}

          <View style={st.totals}>
            <View style={st.totalRow}>
              <Text style={st.muted}>{t('sale.productsQty', { items: totals.items, qty: qtyText(totals.qty) })}</Text>
              <Text style={st.muted}>{t('sale.creditBill')}</Text>
            </View>
            <TotalRow label={t('sale.subtotal')} value={formatAmount(totals.subtotalPaise)} />
            <View style={[st.totalRow, { alignItems: 'center' }]}>
              <Text style={st.totalLabel}>{t('sale.discount')}</Text>
              <View style={st.discBoxes}>
                <TextInput
                  value={draft.discPerc}
                  onChangeText={(v) => dispatch(billDiscPercTyped(decimalInput(v)))}
                  accessibilityLabel={t('sale.discPercLabel')}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  maxLength={6}
                  style={[st.discInput, { width: 56, textAlign: 'center' }]}
                />
                <Text style={st.muted}>%</Text>
                <TextInput
                  value={discAmountShown}
                  onChangeText={(v) => dispatch(billDiscAmountTyped(decimalInput(v)))}
                  accessibilityLabel={t('sale.discAmountLabel')}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  maxLength={10}
                  style={[st.discInput, { width: 92, textAlign: 'right' }]}
                />
              </View>
            </View>
            {problem ? <Text style={st.error}>{t(`sale.billProblems.${problem}`)}</Text> : null}
            {totals.taxPaise > 0 ? (
              <TotalRow
                label={t('sale.tax', { cgst: formatAmount(totals.cgstPaise), sgst: formatAmount(totals.sgstPaise) })}
                value={formatAmount(totals.taxPaise)}
              />
            ) : null}
            {totals.roundOffPaise !== 0 ? (
              <TotalRow label={t('sale.roundOff')} value={`${totals.roundOffPaise < 0 ? '−' : '+'}${formatAmount(Math.abs(totals.roundOffPaise))}`} />
            ) : null}
            <View style={st.grand} accessible accessibilityLabel={`${t('sale.total')}: ${formatAmount(totals.totalPaise)}`}>
              <Text style={st.grandLabel}>{t('sale.total')}</Text>
              <Text style={st.grandValue}>{formatAmount(totals.totalPaise)}</Text>
            </View>
          </View>

          <TextField
            label={t('order.remarks')}
            value={draft.remarks}
            onChangeText={(v) => dispatch(billRemarksTyped(v))}
            placeholder={t('order.optional')}
            multiline
            maxLength={BILL_REMARKS_MAX}
            style={st.remarks}
          />
        </ScrollView>
        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Button title={t('sale.back')} variant="outline" onPress={() => router.back()} style={st.footerBtn} />
          <Button title={t('order.save')} onPress={askSave} disabled={totals.items === 0} style={st.footerBtn} />
        </View>
      </KeyboardAvoidingView>

      <Modal visible={confirm !== null} transparent animationType="fade" onRequestClose={closeConfirm}>
        <View style={st.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('common.cancel')} onPress={closeConfirm} />
          <View style={st.dialog} accessibilityViewIsModal accessibilityLabel={t('sale.confirmTitle')}>
            <Text style={st.dialogTitle} accessibilityRole="header">
              {t('sale.confirmTitle')}
            </Text>
            <View style={st.facts}>
              <Fact label={t('sale.invoiceNo')} value={confirm?.refNo ?? ''} strong />
              <Fact label={t('sale.customer')} value={c ? customerName(c) : ''} />
              <Fact label={t('sale.payment')} value={t('sale.credit')} />
              <View style={st.fact}>
                <Text style={st.factLabel}>{t('sale.total')}</Text>
                <Text style={st.factTotal}>{formatAmount(totals.totalPaise)}</Text>
              </View>
            </View>
            <Text style={st.dialogNote}>{t('sale.confirmNote')}</Text>
            <View style={st.dialogButtons}>
              <Button title={t('common.cancel')} variant="outline" onPress={closeConfirm} disabled={saving} style={st.footerBtn} />
              <Button title={t('sale.saveBill')} onPress={doSave} loading={saving} style={st.footerBtn} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function BillLine({
  line,
  amounts,
  isShort,
  language,
  onQty,
  onOpen,
  onRemove,
}: {
  line: SaleLine;
  amounts: SaleLineAmounts;
  isShort: boolean;
  language: string;
  onQty: (qty: string) => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const name = itemName({ itemNameEn: line.name, itemNameTa: line.nameTa }, language);
  const mrp = toPaise(line.mrp);
  const meta =
    t('sale.lineMeta', { unit: line.unitName, price: formatAmount(toPaise(line.price) ?? 0) }) +
    (mrp ? t('sale.lineMrp', { mrp: formatAmount(mrp) }) : '') +
    t('sale.lineStock', { qty: qtyText(Math.max(0, line.stockLeft)) }) +
    (num(line.discPerc) > 0 ? t('sale.lineDisc', { perc: line.discPerc }) : '') +
    (num(line.discPerUnit) > 0 ? t('sale.lineDiscRs', { rs: line.discPerUnit }) : '');
  return (
    <View style={[st.line, amounts.qty <= 0 && { opacity: 0.6 }, isShort && st.lineShort]}>
      <Pressable accessibilityRole="button" accessibilityHint={t('sale.itemTitle')} onPress={onOpen} style={st.lineMain}>
        <Text style={st.lineName}>{name}</Text>
        <Text style={st.lineMeta}>{meta}</Text>
        {isShort ? <Text style={st.error}>{t('sale.shortStock', { qty: qtyText(Math.max(0, line.stockLeft)) })}</Text> : null}
        <Text style={st.lineAmount}>{formatAmount(amounts.valuePaise)}</Text>
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
        style={[st.qty, isShort && { borderColor: colors.danger }]}
      />
      <Pressable accessibilityRole="button" accessibilityLabel={t('sale.removeLine', { name })} onPress={onRemove} hitSlop={4} style={st.delete}>
        <Ionicons name="trash-outline" size={20} color={colors.textMuted} />
      </Pressable>
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

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={st.fact}>
      <Text style={st.factLabel}>{label}</Text>
      <Text style={[st.factValue, strong && { fontWeight: '600' }]} numberOfLines={1}>
        {value}
      </Text>
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
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md + 2,
    paddingVertical: 10,
    paddingLeft: spacing.md + 2,
    paddingRight: 6,
  },
  lineShort: { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5' },
  lineMain: { flex: 1, gap: 3, minWidth: 0 },
  lineName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  lineMeta: { fontSize: 12, color: colors.textMuted },
  lineAmount: { fontSize: 14, fontWeight: '600', color: colors.text },
  qty: {
    width: 56,
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
  delete: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  totals: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
    gap: 7,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  totalLabel: { flexShrink: 1, fontSize: 14, color: colors.text },
  totalValue: { fontSize: 14, color: colors.text },
  muted: { fontSize: 14, color: colors.textMuted },
  discBoxes: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  discInput: {
    height: 36,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.sm + 2,
    paddingHorizontal: spacing.sm,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  error: { fontSize: font.sm, color: colors.danger },
  grand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', borderTopWidth: 1, borderTopColor: '#F1EDE4', paddingTop: 9, marginTop: 2 },
  grandLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  grandValue: { fontSize: 24, fontWeight: '700', color: colors.text },
  remarks: { minHeight: 72, textAlignVertical: 'top', paddingTop: spacing.md },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerBtn: { flex: 1, height: 52 },
  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.5)', justifyContent: 'center', padding: spacing.xl },
  dialog: { backgroundColor: colors.surface, borderRadius: 20, paddingTop: 22, paddingHorizontal: 20, paddingBottom: 20, gap: 14 },
  dialogTitle: { fontSize: 19, fontWeight: '600', color: colors.text },
  facts: { backgroundColor: colors.bg, borderRadius: radius.md + 2, paddingVertical: spacing.md, paddingHorizontal: spacing.md + 2, gap: spacing.sm },
  fact: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.md },
  factLabel: { fontSize: 14, color: colors.textMuted },
  factValue: { flexShrink: 1, fontSize: 14, color: colors.text, textAlign: 'right' },
  factTotal: { fontSize: 20, fontWeight: '700', color: colors.text },
  dialogNote: { fontSize: font.sm, color: colors.textMuted, lineHeight: 18 },
  dialogButtons: { flexDirection: 'row', gap: 10 },
});

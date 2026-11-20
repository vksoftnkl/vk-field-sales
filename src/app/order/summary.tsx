import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, usePreventRemove } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CalendarDialog } from '@/components/calendar-dialog';
import { ScreenHeader } from '@/components/screen-header';
import { Button, SelectField, TextField, type SelectOption } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { branchQuery } from '@/features/company/company';
import { customerDetailQuery } from '@/features/customers/queries';
import { currentBalance } from '@/features/ledger/ledger';
import { ledgerYearsQuery } from '@/features/ledger/queries';
import { creditView } from '@/features/orders/credit';
import { applyOffersSet, deliveryPicked, orderCleared, prioritySet, remarksTyped, type SoLine } from '@/features/orders/order-draft';
import { itemName } from '@/features/orders/order-items';
import { num, qtyText, toPaise } from '@/features/orders/order-math';
import {
  companyQuery,
  customerName,
  oldestOpenBillQuery,
  orderCustomerQuery,
  orderQuery,
  REMARKS_MAX,
  saveOrder,
  soUnitsQuery,
  visitCustomerQuery,
} from '@/features/orders/queries';
import { backOrderQty, soLineAmounts, soTotals } from '@/features/orders/so-math';
import { priorityNeedsRemark, SO_PRIORITIES, toPriority } from '@/features/orders/so-priority';
import { rupees } from '@/features/schemes/offer-text';
import { resolveFreeUnit } from '@/features/schemes/scheme-load';
import type { LineScheme, OrderFreeLine } from '@/features/schemes/scheme-order';
import { useOrderSchemes } from '@/features/schemes/use-order-schemes';
import { formatDay } from '@/lib/date-range';
import { formatAmount, todayISO } from '@/lib/money';
import { store, useAppDispatch, useAppSelector } from '@/store';
import { getDeviceUid } from '@/sync/sync-store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Review order (canvas 3b, steps 5–6; was Order summary): the lines, the order's delivery date,
 * priority (URGENT needs a remark) and remarks, and the totals with GST, freight, cooly and round off —
 * an estimate, since the office confirms prices and schemes. Over the credit limit or with an
 * overdue bill it warns, never blocks (Qt asks "Order on credit anyway?"). Save order asks first,
 * as the Bill does, then keeps the order on the phone for the next Sync. The term is always
 * Credit, shown fixed (user's rule, 2026-11-18).
 */
export default function ReviewOrderScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const draft = useAppSelector((st) => st.orderDraft);
  const userId = useAppSelector((st) => st.session.session?.userId ?? '');
  const customerId = draft.customerId ?? '';
  const companyId = draft.companyId ?? '';
  const today = todayISO();

  const { data: found } = useLiveQuery(orderCustomerQuery(customerId), [customerId]);
  const { data: company } = useLiveQuery(companyQuery(companyId), [companyId]);
  const branchId = draft.branchId ?? '';
  const { data: branch } = useLiveQuery(branchQuery(branchId), [branchId]);
  const { data: detail } = useLiveQuery(customerDetailQuery(customerId), [customerId]);
  const { data: extra } = useLiveQuery(visitCustomerQuery(customerId), [customerId]);
  const { data: years } = useLiveQuery(ledgerYearsQuery(customerId), [customerId]);
  const { data: oldest } = useLiveQuery(oldestOpenBillQuery(customerId, companyId), [customerId, companyId]);
  const c = found[0];
  const x = extra[0];
  const [stock] = useState(() => new Map(soUnitsQuery(companyId).all().map((u) => [u.iucId, Number(u.stockQty) || 0])));
  const [orderDate] = useState(() => (draft.editingSoId ? orderQuery(draft.editingSoId).get()?.soOrderDate : undefined) ?? today);

  // The offers on the order, worked out from the draft (what Save writes is worked out the same way).
  const { order, applyOffers, customer, unresolvedFree } = useOrderSchemes();
  const totals = soTotals(order.priced);
  const freeUnits = useMemo(() => order.freeLines.map((f) => resolveFreeUnit(companyId, f)), [order, companyId]);
  const gaps = useMemo(() => (applyOffers ? order.orderOffers().filter((o) => !o.applied && o.nextBand) : []), [order, applyOffers]);
  const credit = creditView({
    outstandingPaise: currentBalance(years) ?? detail[0]?.outstandingPaise ?? 0,
    limitPaise: toPaise(x?.cusCreditAmtLimit) ?? 0,
    creditDays: x?.cusCreditDays ?? 0,
    oldestBillDate: oldest[0]?.date ?? null,
    today,
    orderPaise: totals.totalPaise,
  });
  const limitPaise = toPaise(x?.cusCreditAmtLimit) ?? 0;

  const [pickDate, setPickDate] = useState(false);
  const [dateError, setDateError] = useState<string>();
  const [submitted, setSubmitted] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const saved = useRef(false);

  const editing = draft.entry === 'edit';
  // Save clears the draft first, so this stops asking once the edit is saved.
  usePreventRemove(editing, ({ repeat }) => {
    Alert.alert(t('so.discardEditTitle'), t('so.discardEditText'), [
      { text: t('order.keep'), style: 'cancel' },
      {
        text: t('order.discard'),
        style: 'destructive',
        onPress: () => {
          dispatch(orderCleared());
          repeat();
        },
      },
    ]);
  });

  // A free line short of stock is a back-order (warn, never block), counting the same unit already ordered.
  const freeBack = (f: OrderFreeLine, k: number): number => {
    const iuc = freeUnits[k]?.iucId;
    if (!iuc) return 0;
    const paid = draft.lines.filter((l) => l.iucId === iuc).reduce((n, l) => n + num(l.qty), 0);
    return Math.max(0, backOrderQty(paid + f.qty, stock.get(iuc) ?? 0) - backOrderQty(paid, stock.get(iuc) ?? 0));
  };
  const delivery = draft.deliveryDate && draft.deliveryDate > orderDate ? draft.deliveryDate : orderDate;
  const remarkNeeded = priorityNeedsRemark(draft.priority) && !draft.remarks.trim();
  const priorityOptions: SelectOption[] = useMemo(() => SO_PRIORITIES.map((p) => ({ value: p, label: t(`so.priorities.${p}`) })), [t]);

  const askSave = () => {
    setSubmitted(true);
    if (saved.current || !c || totals.items === 0 || remarkNeeded) return;
    setConfirm(true);
  };

  const doSave = () => {
    const d = store.getState().orderDraft;
    if (saved.current || !c) return;
    setSaving(true);
    try {
      const { soId } = saveOrder(d, c, userId, getDeviceUid());
      saved.current = true;
      const wasEdit = d.entry === 'edit';
      setConfirm(false);
      // Cleared first, and the screens closed a frame later, once the flow has drawn itself
      // without items: then it lets itself be closed without asking to discard.
      dispatch(orderCleared());
      requestAnimationFrame(() => {
        if (wasEdit) {
          router.dismissTo({ pathname: '/orders/[soId]', params: { soId } });
        } else {
          router.dismissTo('/customers');
          router.push({ pathname: '/orders/[soId]', params: { soId, saved: '1' } });
        }
      });
    } catch (e) {
      setSaving(false);
      setConfirm(false);
      const sent = e instanceof Error && e.message === 'ORDER_SENT';
      if (e instanceof Error && e.message === 'ORDER_NO_BRANCH') return Alert.alert(t('so.pickCompany'), t('so.pickCompanyNote'));
      Alert.alert(sent ? t('so.sentMeanwhileTitle') : t('common.error'), sent ? t('so.sentMeanwhileText') : undefined);
    }
  };

  const closeConfirm = () => {
    if (!saving) setConfirm(false);
  };

  const addMore = () => {
    if (editing) router.push({ pathname: '/order/[customerId]', params: { customerId, companyId } });
    else router.back();
  };

  const subtitle = [c ? customerName(c) : '', company[0]?.name ?? ''].filter(Boolean).join(' · ');
  const warnText = [
    credit.overdue && credit.oldestDays !== null ? t('so.warnOldest', { days: credit.oldestDays }) : null,
    credit.overLimit
      ? t('so.warnOver', { after: formatAmount(credit.afterOrderPaise), limit: formatAmount(limitPaise) })
      : credit.hasLimit && credit.warn
        ? t('so.warnLimit', { after: formatAmount(credit.afterOrderPaise), limit: formatAmount(limitPaise) })
        : null,
  ]
    .filter(Boolean)
    .join(' ');
  const itemsQty = t('so.itemsQty', { count: totals.items, qty: qtyText(totals.qty) }) + (order.freeQty > 0 ? ` + ${t('offers.plusFree', { qty: qtyText(order.freeQty) })}` : '');
  const appliedWhat = [
    totals.schemeDiscPaise + totals.billSchemeDiscPaise > 0 ? t('offers.gives.amount', { amount: formatAmount(totals.schemeDiscPaise + totals.billSchemeDiscPaise) }) : '',
    ...order.freeLines.map((f) => t('offers.freeQtyUnit', { qty: qtyText(f.qty), unit: f.freeUnitName })),
  ]
    .filter(Boolean)
    .join(' + ');

  return (
    <View style={st.root}>
      <ScreenHeader title={t('so.reviewTitle')} subtitle={subtitle} backLabel={editing ? t('common.cancel') : t('so.backToItems')} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          {credit.warn && warnText ? (
            <View style={st.warn} accessibilityRole="alert">
              <Ionicons name="warning-outline" size={18} color="#92400E" />
              <Text style={st.warnText}>{warnText}</Text>
            </View>
          ) : null}

          <Text style={st.heading} accessibilityRole="header">
            {t('so.lines', { count: totals.items })}
          </Text>
          {draft.lines.length === 0 ? <Text style={st.empty}>{t('order.empty')}</Text> : null}
          {draft.lines.map((l, i) => (
            <View key={l.itemId} style={{ gap: 10 }}>
              <ReviewLine
                line={order.priced[i] ?? l}
                scheme={order.lines[i]}
                back={backOrderQty(num(l.qty), stock.get(l.iucId) ?? 0)}
                language={i18n.language}
                onOpen={() => router.push({ pathname: '/order/item', params: { itemId: l.itemId } })}
              />
              {order.freeLines.map((f, k) =>
                f.afterIndex === i ? <FreeLine key={k} f={f} back={freeBack(f, k)} language={i18n.language} /> : null,
              )}
            </View>
          ))}
          {order.freeLines.map((f, k) => (f.afterIndex === null ? <FreeLine key={`end${k}`} f={f} back={freeBack(f, k)} language={i18n.language} /> : null))}
          <Pressable accessibilityRole="button" onPress={addMore} style={({ pressed }) => [st.addMore, pressed && { backgroundColor: colors.surface }]}>
            <Ionicons name="add" size={18} color={colors.primary} />
            <Text style={st.addMoreText}>{t('so.addMore')}</Text>
          </Pressable>

          <View style={st.card} accessibilityLabel={t('offers.apply.title')}>
            <View style={st.applyRow}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={st.applyTitle}>{t('offers.apply.title')}</Text>
                <Text style={st.smallLabel}>{customer && !customer.cusAllowPromotion ? t('offers.apply.shopNo') : t('offers.apply.note')}</Text>
              </View>
              <Switch
                value={applyOffers}
                onValueChange={(v) => void dispatch(applyOffersSet(v))}
                disabled={!customer?.cusAllowPromotion}
                accessibilityLabel={t('offers.apply.title')}
                trackColor={{ true: colors.primary, false: colors.inputBorder }}
                thumbColor={colors.surface}
              />
            </View>
            {applyOffers ? (
              order.appliedNames.length > 0 ? (
                <Text style={st.applied}>{t('offers.apply.summary', { count: order.appliedNames.length, what: appliedWhat })}</Text>
              ) : (
                <Text style={st.smallLabel}>{t('offers.apply.none')}</Text>
              )
            ) : null}
            {gaps.map((o) => (
              <Text key={o.schemeId} style={st.gap}>
                {t('offers.apply.gap', { name: o.name, more: o.unit === 'money' ? t('offers.moreMoney', { amount: rupees(o.nextBand!.more) }) : t('offers.moreQty', { qty: qtyText(o.nextBand!.more) }) })}
              </Text>
            ))}
            {unresolvedFree.length > 0 ? <Text style={st.gap}>{t('offers.missingFree', { names: unresolvedFree.map((f) => f.freeItemName).join(', ') })}</Text> : null}
          </View>

          <Text style={st.heading} accessibilityRole="header">
            {t('so.orderDetails')}
          </Text>
          <View style={st.card}>
            <View style={st.pair}>
              <View style={st.pairCell}>
                <Text style={st.smallLabel}>{t('so.orderDate')}</Text>
                <Text style={st.pairValue}>{formatDay(orderDate, names)}</Text>
              </View>
              <View style={st.pairCell}>
                <Text style={st.smallLabel}>{t('so.term')}</Text>
                <Text style={st.pairValue}>{t('so.credit')}</Text>
              </View>
            </View>
            <View style={{ gap: 6 }}>
              <Text style={st.fieldLabel}>{t('so.deliveryDate')}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`${t('so.deliveryDate')}: ${formatDay(delivery, names)}`} onPress={() => setPickDate(true)} style={[st.dateBtn, !!dateError && { borderColor: colors.danger }]}>
                <Text style={st.dateText}>{formatDay(delivery, names)}</Text>
                <Ionicons name="calendar-outline" size={18} color={colors.primary} />
              </Pressable>
              {dateError ? <Text style={st.error}>{dateError}</Text> : null}
            </View>
            <SelectField label={t('so.priority')} value={draft.priority} options={priorityOptions} onChange={(v) => dispatch(prioritySet(toPriority(v)))} />
            <TextField
              label={priorityNeedsRemark(draft.priority) ? t('so.remarksUrgent') : t('so.remarksOptional')}
              value={draft.remarks}
              onChangeText={(v) => dispatch(remarksTyped(v))}
              multiline
              maxLength={REMARKS_MAX}
              style={st.remarks}
              error={submitted && remarkNeeded ? t('so.urgentNeedsRemark') : undefined}
            />
          </View>

          <View style={st.card} accessibilityLabel={t('so.totals')}>
            <TotalRow label={t('so.grossQty', { qty: qtyText(totals.qty) })} value={formatAmount(totals.grossPaise)} />
            {totals.discPaise > 0 ? <TotalRow label={t('so.itemDiscount')} value={`−${formatAmount(totals.discPaise)}`} /> : null}
            {totals.schemeDiscPaise > 0 ? <TotalRow label={t('offers.schemeDiscount')} value={`−${formatAmount(totals.schemeDiscPaise)}`} /> : null}
            {totals.billSchemeDiscPaise > 0 ? <TotalRow label={t('offers.orderOfferTotal')} value={`−${formatAmount(totals.billSchemeDiscPaise)}`} /> : null}
            <TotalRow label={t('so.taxable')} value={formatAmount(totals.taxablePaise)} />
            {totals.igstPaise > 0 ? (
              <TotalRow label={t('so.igst')} value={formatAmount(totals.igstPaise)} />
            ) : (
              <>
                <TotalRow label={t('so.cgst')} value={formatAmount(totals.cgstPaise)} />
                <TotalRow label={t('so.sgst')} value={formatAmount(totals.sgstPaise)} />
              </>
            )}
            {totals.freightPaise > 0 ? <TotalRow label={t('order.freightLabel')} value={formatAmount(totals.freightPaise)} /> : null}
            {totals.loadPaise > 0 ? <TotalRow label={t('so.loading')} value={formatAmount(totals.loadPaise)} /> : null}
            {totals.roundOffPaise !== 0 ? (
              <TotalRow label={t('so.roundOff')} value={`${totals.roundOffPaise > 0 ? '+' : '−'}${formatAmount(Math.abs(totals.roundOffPaise))}`} />
            ) : null}
            <View style={st.grand} accessible accessibilityLabel={`${t('order.orderTotal')}: ${formatAmount(totals.totalPaise)}`}>
              <Text style={st.grandLabel}>{t('order.orderTotal')}</Text>
              <Text style={st.grandValue}>{formatAmount(totals.totalPaise)}</Text>
            </View>
            <Text style={st.smallLabel}>{t('offers.estimate')}</Text>
          </View>
        </ScrollView>
        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={{ flex: 1, gap: 1 }}>
            <Text style={st.smallLabel}>{itemsQty}</Text>
            <Text style={st.footTotal}>{formatAmount(totals.totalPaise)}</Text>
          </View>
          <Button title={t('order.saveOrder')} onPress={askSave} disabled={totals.items === 0} style={st.saveBtn} />
        </View>
      </KeyboardAvoidingView>

      <CalendarDialog
        visible={pickDate}
        value={delivery}
        today={today}
        onCancel={() => setPickDate(false)}
        onPick={(iso) => {
          setPickDate(false);
          if (iso < orderDate) return setDateError(t('so.deliveryBefore', { date: formatDay(orderDate, names) }));
          setDateError(undefined);
          dispatch(deliveryPicked(iso));
        }}
      />

      <Modal visible={confirm} transparent animationType="fade" onRequestClose={closeConfirm}>
        <View style={st.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel={t('common.cancel')} onPress={closeConfirm} />
          <View style={st.dialog} accessibilityViewIsModal accessibilityLabel={t('order.saveTitle')}>
            <Text style={st.dialogTitle} accessibilityRole="header">
              {t('order.saveTitle')}
            </Text>
            <View style={st.facts}>
              <Fact label={t('so.customer')} value={c ? customerName(c) : ''} />
              <Fact label={t('so.company')} value={[company[0]?.name, branch[0]?.name].filter(Boolean).join(' · ')} />
              <Fact label={t('so.linesLabel')} value={itemsQty} />
              <Fact label={t('so.delivery')} value={formatDay(delivery, names)} />
              <Fact label={t('so.priority')} value={t(`so.priorities.${draft.priority}`)} />
              <View style={st.fact}>
                <Text style={st.factLabel}>{t('so.total')}</Text>
                <Text style={st.factTotal}>{formatAmount(totals.totalPaise)}</Text>
              </View>
            </View>
            <Text style={st.dialogNote}>{t('so.confirmNote')}</Text>
            <View style={st.dialogButtons}>
              <Button title={t('so.back')} variant="outline" onPress={() => setConfirm(false)} disabled={saving} style={st.dialogBtn} />
              <Button title={t('order.saveOrder')} onPress={doSave} loading={saving} style={st.dialogBtn} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function ReviewLine({ line, scheme, back, language, onOpen }: { line: SoLine; scheme: LineScheme | undefined; back: number; language: string; onOpen: () => void }) {
  const { t } = useTranslation();
  const a = soLineAmounts(line);
  const name = itemName({ itemNameEn: line.name, itemNameTa: line.nameTa }, language);
  const disc =
    a.discPaise > 0
      ? line.discMode === 'perc'
        ? t('so.discPerc', { perc: line.disc })
        : line.discMode === 'perUnit'
          ? t('so.discPerUnit', { amount: formatAmount(toPaise(line.disc) ?? 0) })
          : t('so.discAmount', { amount: formatAmount(a.discPaise) })
      : null;
  const meta = [
    t('so.qtyRate', { qty: qtyText(a.qty), unit: line.unitName, price: formatAmount(toPaise(line.price) ?? 0) }),
    disc,
    t('so.gstPerc', { gst: String(Number(num(line.taxPerc).toFixed(3))) }),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Pressable accessibilityRole="button" accessibilityHint={t('order.itemTitle')} onPress={onOpen} style={({ pressed }) => [st.line, pressed && { backgroundColor: colors.bg }]}>
      <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
        <Text style={st.lineName}>{name}</Text>
        <Text style={st.lineMeta}>{meta}</Text>
        {scheme && a.schemePaise + a.billSchemePaise > 0 ? (
          <Text style={st.lineScheme}>
            {[
              a.schemePaise > 0
                ? Number(scheme.schDiscPerc) > 0
                  ? t('offers.line.perc', { name: scheme.schemeName ?? '', perc: scheme.schDiscPerc })
                  : Number(scheme.schDiscQty) > 0
                    ? t('offers.line.perUnit', { name: scheme.schemeName ?? '', amount: formatAmount(toPaise(scheme.schDiscQty) ?? 0) })
                    : t('offers.line.plain', { name: scheme.schemeName ?? '' })
                : null,
              a.schemePaise > 0 ? `−${formatAmount(a.schemePaise)}` : null,
              a.billSchemePaise > 0 ? `${t('offers.orderOfferTotal')} −${formatAmount(a.billSchemePaise)}` : null,
            ]
              .filter(Boolean)
              .join(' ')}
          </Text>
        ) : null}
        {back > 0 ? (
          <View style={st.lineNote}>
            <Text style={st.lineNoteText}>{t('so.backOrderShort', { qty: qtyText(back), unit: line.unitName })}</Text>
          </View>
        ) : null}
      </View>
      <Text style={st.lineAmount}>{formatAmount(a.lineTotalPaise)}</Text>
    </Pressable>
  );
}

/** A free line (green, FREE, ₹0.00) under the line that earned it: follows the quantities, not editable or deletable. */
function FreeLine({ f, back, language }: { f: OrderFreeLine; back: number; language: string }) {
  const { t } = useTranslation();
  const name = itemName({ itemNameEn: f.freeItemName, itemNameTa: null }, language);
  return (
    <View style={st.freeLine} accessible accessibilityLabel={`${t('offers.free')}: ${f.qtyText} ${f.freeUnitName} ${name}`}>
      <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
        <View style={st.freeHead}>
          <View style={st.freeTag}>
            <Text style={st.freeTagText}>{t('offers.free')}</Text>
          </View>
          <Text style={st.freeName}>{t('offers.freeLine', { qty: f.qtyText, unit: f.freeUnitName, name })}</Text>
        </View>
        <Text style={st.freeScheme}>{f.schemeName}</Text>
        {back > 0 ? (
          <View style={st.lineNote}>
            <Text style={st.lineNoteText}>{t('so.backOrderShort', { qty: qtyText(back), unit: f.freeUnitName })}</Text>
          </View>
        ) : null}
      </View>
      <Text style={st.lineAmount}>{formatAmount(0)}</Text>
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.fact}>
      <Text style={st.factLabel}>{label}</Text>
      <Text style={st.factValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, paddingTop: spacing.md, gap: 10 },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xl },
  warn: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: '#FEF3C7', borderRadius: radius.md + 2, paddingVertical: 10, paddingHorizontal: spacing.md + 2 },
  warnText: { flex: 1, fontSize: font.sm, lineHeight: 18, color: '#92400E' },
  heading: { marginTop: 2, fontSize: font.md, fontWeight: '600', color: colors.text },
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
    paddingRight: spacing.md,
  },
  lineName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  lineMeta: { fontSize: 12.5, color: colors.textMuted },
  lineNote: { alignSelf: 'flex-start', backgroundColor: '#FEF3C7', borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 1 },
  lineNoteText: { fontSize: 12, fontWeight: '600', color: '#92400E' },
  lineAmount: { fontSize: font.md, fontWeight: '600', color: colors.text },
  lineScheme: { fontSize: 12.5, fontWeight: '600', color: '#166534' },
  freeLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginLeft: spacing.lg,
    backgroundColor: '#F0FDF4',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: radius.md + 2,
    paddingVertical: 10,
    paddingLeft: spacing.md + 2,
    paddingRight: spacing.md,
  },
  freeHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  freeTag: { backgroundColor: '#166534', borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  freeTagText: { fontSize: 11.5, fontWeight: '700', color: colors.onPrimary },
  freeName: { flex: 1, fontSize: font.md, fontWeight: '600', color: '#166534' },
  freeScheme: { fontSize: 12.5, color: '#166534' },
  applyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  applyTitle: { fontSize: font.md, fontWeight: '600', color: colors.text },
  applied: { fontSize: 14, fontWeight: '600', color: '#166534' },
  gap: { fontSize: 13, color: '#92400E' },
  addMore: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#A8A29E',
    borderRadius: radius.md + 2,
  },
  addMoreText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.md + 2, gap: spacing.md },
  pair: { flexDirection: 'row', gap: 10 },
  pairCell: { flex: 1, gap: 4 },
  pairValue: { fontSize: font.md, fontWeight: '600', color: colors.text },
  smallLabel: { fontSize: 12, color: colors.textMuted },
  fieldLabel: { fontSize: font.sm, fontWeight: '500', color: colors.textLabel },
  dateBtn: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: radius.md + 2,
    paddingHorizontal: spacing.md + 2,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateText: { fontSize: font.md, color: colors.text },
  error: { fontSize: font.sm, color: colors.danger },
  remarks: { minHeight: 64, textAlignVertical: 'top', paddingTop: spacing.md },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  totalLabel: { fontSize: 14, color: colors.textMuted },
  totalValue: { fontSize: 14, color: colors.text },
  grand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', borderTopWidth: 1, borderTopColor: '#F1EDE4', paddingTop: spacing.sm },
  grandLabel: { fontSize: font.md, fontWeight: '600', color: colors.text },
  grandValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  footer: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  footTotal: { fontSize: 19, fontWeight: '700', color: colors.text },
  saveBtn: { height: 52, minWidth: 170 },
  backdrop: { flex: 1, backgroundColor: 'rgba(28,25,23,0.5)', justifyContent: 'center', paddingHorizontal: spacing.xl },
  dialog: { backgroundColor: colors.surface, borderRadius: 20, paddingTop: 22, paddingHorizontal: 20, paddingBottom: 20, gap: 14 },
  dialogTitle: { fontSize: 19, fontWeight: '600', color: colors.text },
  facts: { backgroundColor: colors.bg, borderRadius: radius.md + 2, paddingVertical: spacing.md, paddingHorizontal: spacing.md + 2, gap: spacing.sm },
  fact: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.md },
  factLabel: { fontSize: 14, color: colors.textMuted },
  factValue: { flexShrink: 1, fontSize: 14, color: colors.text, textAlign: 'right' },
  factTotal: { fontSize: 20, fontWeight: '700', color: colors.text },
  dialogNote: { fontSize: font.sm, lineHeight: 19, color: colors.textMuted },
  dialogButtons: { flexDirection: 'row', gap: 10 },
  dialogBtn: { flex: 1, height: 48 },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { useDateNames } from '@/components/use-date-names';
import { currentContext } from '@/features/company/company';
import { CompanySheet } from '@/features/company/company-sheet';
import { orderLoaded, orderRepeated } from '@/features/orders/order-draft';
import { itemName } from '@/features/orders/order-items';
import { num, qtyText, toPaise } from '@/features/orders/order-math';
import { asOfText, CUSTOMER_FIRST, isOnPhone, SO_TONES, soState, type SoState } from '@/features/orders/order-status';
import {
  companyQuery,
  deleteOrder,
  lineName,
  loadOrderDraft,
  orderCustomerQuery,
  orderLinesQuery,
  orderQuery,
  orderRef,
  pendingOrdersCountQuery,
  pendingVisitsCountQuery,
  repeatLines,
  type SavedLine,
  type SavedOrder,
} from '@/features/orders/queries';
import { useSendNow } from '@/features/orders/use-send-now';
import { formatDay } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { useAppDispatch } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

/** What a line costs the shop: taxable + GST (older lines: what was saved). */
const lineAmount = (l: SavedLine['line']): number =>
  l.soiTaxableAmt !== null && l.soiTaxAmt !== null ? (toPaise(l.soiTaxableAmt) ?? 0) + (toPaise(l.soiTaxAmt) ?? 0) : (toPaise(l.soiNetAmt) ?? 0);

/** "MOBILE_BRANCH_NOT_RESOLVED: The company …" → its code and words. */
function splitError(e: string | null): { code: string | null; text: string } {
  const m = /^([A-Z][A-Z0-9_]+):\s*(.*)$/s.exec(e ?? '');
  return m ? { code: m[1]!, text: m[2]! } : { code: null, text: e ?? '' };
}

/**
 * One phone order (canvas 3b, steps 6b, 7b and 8), shown as where it stands:
 *  - waiting to send: saved on this phone, what happens next; it can still be edited or deleted;
 *  - sent back: VK Nex refused it, in its own words with its code; fix, send again or delete;
 *  - on VK Nex: its number, status, lines; Share and Repeat order (Qt's Copy as new). Changes
 *    and cancelling are done in the office then.
 * `saved=1` = just saved (Order saved, closing goes to the customers).
 */
export default function OrderScreen() {
  const { soId, saved } = useLocalSearchParams<{ soId: string; saved?: string }>();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const { data: found, updatedAt } = useLiveQuery(orderQuery(soId), [soId]);
  const { data: lines } = useLiveQuery(orderLinesQuery(soId), [soId]);
  const o = found[0];
  const { data: company } = useLiveQuery(companyQuery(o?.soCompanyId ?? ''), [o?.soCompanyId]);
  const { data: waitingOrders } = useLiveQuery(pendingOrdersCountQuery());
  const { data: waitingVisits } = useLiveQuery(pendingVisitsCountQuery());
  const { sending, result, send } = useSendNow();
  // Repeat order with no company and branch picked yet: Switch company first, then the repeat.
  const [picking, setPicking] = useState(false);

  if (!o) {
    return (
      <View style={st.root}>
        <ScreenHeader title={t('so.myOrders')} backLabel={t('so.back')} />
        {updatedAt ? <Text style={st.empty}>{t('so.orderGone')}</Text> : null}
      </View>
    );
  }

  const state = soState(o);
  const when = (iso: string) => asOfText(iso, names, t('so.today'));
  const qty = lines.reduce((s, l) => s + num(l.line.soiOrderQty), 0);
  const total = formatAmount(toPaise(o.soOrderAmt) ?? 0);
  const itemsQty = t('so.itemsQty', { count: lines.length, qty: qtyText(qty) });
  const companyName = company[0]?.name ?? '';
  const nameOf = (l: SavedLine) => {
    const n = lineName(l);
    return itemName({ itemNameEn: n.en, itemNameTa: n.ta }, i18n.language);
  };
  const unitOf = (l: SavedLine) => l.line.appUnitName ?? '';

  const share = () => {
    const rows = lines.map((l) => `• ${nameOf(l)}: ${qtyText(num(l.line.soiOrderQty))} ${unitOf(l)} × ${formatAmount(toPaise(l.line.soiRate) ?? 0)} = ${formatAmount(lineAmount(l.line))}`);
    const message = [
      `${o.soCustName}${companyName ? ` · ${companyName}` : ''}`,
      t('so.shareHead', { ref: orderRef(o), date: formatDay(o.soOrderDate, names) }),
      ...rows,
      t('so.shareTotal', { total }),
      o.soDeliveryDate ? t('so.shareDelivery', { date: formatDay(o.soDeliveryDate, names) }) : null,
      o.soRemarks ? o.soRemarks : null,
    ]
      .filter(Boolean)
      .join('\n');
    void Share.share({ message });
  };

  const edit = () => {
    const d = loadOrderDraft(o.soId);
    if (!d) return Alert.alert(t('so.sentMeanwhileTitle'), t('so.sentMeanwhileText'));
    dispatch(orderLoaded(d));
    router.push('/order/summary');
  };

  const remove = () =>
    Alert.alert(t('so.deleteTitle'), t('so.deleteText', { name: o.soCustName, total }), [
      { text: t('order.keep'), style: 'cancel' },
      {
        text: t('so.delete'),
        style: 'destructive',
        onPress: () => {
          try {
            deleteOrder(o.soId);
            router.back();
          } catch {
            Alert.alert(t('so.sentMeanwhileTitle'), t('so.sentMeanwhileText'));
          }
        },
      },
    ]);

  // A new order: for the company and branch picked in Switch company now, like Take order.
  const repeat = () => {
    const ctx = currentContext();
    if (!ctx) return setPicking(true);
    const c = orderCustomerQuery(o.soCustId).get();
    const r = c ? repeatLines(o.soId, c, ctx.companyId) : null;
    if (!c || !r) return Alert.alert(t('customerDetail.notFound'));
    dispatch(orderRepeated({ customerId: o.soCustId, companyId: ctx.companyId, branchId: ctx.branchId, lines: r.lines }));
    router.push({ pathname: '/order/[customerId]', params: { customerId: o.soCustId, companyId: ctx.companyId } });
    if (r.skipped > 0) Alert.alert(t('so.repeatSkippedTitle'), t('so.repeatSkippedText', { count: r.skipped }));
  };

  const sendLine = result ? (
    <Text style={[st.result, !result.ok && { color: colors.danger }]} accessibilityLiveRegion="polite">
      {result.text}
    </Text>
  ) : null;

  // ── Sent back by VK Nex ───────────────────────────────────────────────────────────────────
  if (state === 'sentBack') {
    const err = splitError(o.appSyncError);
    return (
      <View style={st.root}>
        <ScreenHeader title={o.soCustName} subtitle={[t('so.phoneRef', { ref: o.soUsrRefno ?? '—' }), companyName].filter(Boolean).join(' · ')} backLabel={t('so.backToOrders')} />
        <ScrollView contentContainerStyle={st.body}>
          <View style={[st.card, { borderColor: '#FCA5A5' }]} accessibilityRole="alert">
            <View style={st.alertHead}>
              <Badge icon="alert-circle-outline" bg="#FEE2E2" fg={colors.danger} />
              <Text style={st.alertTitle}>{t('so.sentBackTitle')}</Text>
            </View>
            <Text style={st.body15}>{err.text}</Text>
            {err.code ? <Text style={st.small}>{err.code}</Text> : null}
          </View>
          <Info icon="phone-portrait-outline" text={t('so.sentBackNote')} />
          <Lines o={o} lines={lines} nameOf={nameOf} unitOf={unitOf} itemsQty={itemsQty} total={total} />
          {sendLine}
        </ScrollView>
        <View style={[st.footer, st.footerCol, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={st.footerRow}>
            <Btn label={t('so.deleteFromPhone')} tone="danger" onPress={remove} />
            <Btn label={t('so.editOrder')} tone="outline" onPress={edit} />
          </View>
          <Btn label={t('so.sendAgain')} tone="primary" onPress={() => void send()} busy={sending} />
        </View>
      </View>
    );
  }

  // ── Waiting to send (just saved, or not sent yet) ───────────────────────────────────────────
  if (isOnPhone(state)) {
    const justSaved = saved === '1';
    const nOrders = waitingOrders[0]?.n ?? 0;
    const nVisits = waitingVisits[0]?.n ?? 0;
    const customerFirst = (o.appSyncError ?? '').startsWith(CUSTOMER_FIRST);
    return (
      <View style={st.root}>
        <ScreenHeader
          title={justSaved ? t('so.savedTitle') : t('so.status.waiting')}
          subtitle={[o.soCustName, companyName].filter(Boolean).join(' · ')}
          backLabel={justSaved ? t('so.closeToCustomers') : t('so.backToOrders')}
        />
        <ScrollView contentContainerStyle={st.body}>
          <View style={[st.card, st.center]}>
            <Badge icon="checkmark" bg="#DCFCE7" fg="#166534" big />
            <Text style={st.bigTitle}>{t('so.savedOnPhone')}</Text>
            <Text style={st.body14}>{`${total} · ${itemsQty}`}</Text>
            <Text style={st.small}>{t('so.phoneRef', { ref: o.soUsrRefno ?? '—' })}</Text>
          </View>

          <View style={st.cardRow}>
            <Badge icon="cloud-upload-outline" bg="#FEF3C7" fg="#92400E" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={st.rowTitle}>{t('so.status.waiting')}</Text>
              <Text style={st.small}>{customerFirst ? t('so.customerFirst') : t('so.waitingNote', { orders: t('so.nOrders', { count: nOrders }), visits: t('so.nVisits', { count: nVisits }) })}</Text>
            </View>
            <Pressable accessibilityRole="button" disabled={sending} onPress={() => void send()} style={({ pressed }) => [st.sendBtn, pressed && { opacity: 0.85 }]}>
              {sending ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={st.sendText}>{t('so.sendNow')}</Text>}
            </Pressable>
          </View>
          {sendLine}

          <View style={st.card}>
            <Text style={st.rowTitle} accessibilityRole="header">
              {t('so.whatNext')}
            </Text>
            <Step done text={t('so.stepSaved')} at={when(o.soCreatedOn)} />
            <Step text={t('so.stepSent')} />
            <Step text={t('so.stepConfirmed')} />
            <Step text={t('so.stepDelivered')} />
          </View>

          <View style={st.footerRow}>
            <Btn label={t('so.share')} tone="outline" onPress={share} />
            <Btn label={t('so.editBeforeSending')} tone="outline" onPress={edit} />
          </View>
          <Pressable accessibilityRole="button" onPress={remove} style={st.linkBtn} hitSlop={8}>
            <Text style={st.linkDanger}>{t('so.deleteFromPhone')}</Text>
          </Pressable>
        </ScrollView>
        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          <Btn label={t('so.myOrders')} tone="outline" onPress={() => router.push('/orders')} />
          <Btn label={t('so.nextCustomer')} tone="primary" onPress={() => router.dismissTo('/customers')} />
        </View>
      </View>
    );
  }

  // ── On VK Nex ───────────────────────────────────────────────────────────────────────────────
  const tone = SO_TONES[state];
  const reached = (s: SoState[]) => s.includes(state);
  const final = state === 'cancelled' || state === 'closed' || state === 'expired';
  return (
    <View style={st.root}>
      <ScreenHeader title={o.soCustName} subtitle={t('so.orderHead', { ref: orderRef(o), when: when(o.soOrderDatetime) })} backLabel={t('so.backToOrders')} />
      <ScrollView contentContainerStyle={st.body}>
        <View style={[st.card, st.summary]}>
          <Cell label={t('order.orderTotal')}>
            <Text style={st.cellValue}>{total}</Text>
          </Cell>
          <Cell label={t('so.delivery')}>
            <Text style={st.cellValue}>{o.soDeliveryDate ? formatDay(o.soDeliveryDate, names).replace(/ \d{4}$/, '') : '—'}</Text>
          </Cell>
          <Cell label={t('so.statusLabel')}>
            <View style={[st.chip, { backgroundColor: tone.bg }]}>
              <Text style={[st.chipText, { color: tone.fg }]}>{t(`so.status.${state}`)}</Text>
            </View>
          </Cell>
        </View>

        <View style={st.card}>
          <Step done text={t('so.stepSavedRef', { ref: o.soUsrRefno ?? '—' })} at={when(o.soCreatedOn)} />
          <Step done text={t('so.stepSentRef', { ref: o.soOrderRefno ?? '—' })} at={o.appSyncedOn ? when(o.appSyncedOn) : undefined} />
          {final ? (
            <Step done current text={t(`so.status.${state}`)} />
          ) : (
            <>
              <Step done={reached(['confirmed', 'part', 'delivered'])} current={state === 'confirmed'} text={t('so.stepConfirmed')} />
              {state === 'part' ? <Step done current text={t('so.status.part')} /> : null}
              <Step done={state === 'delivered'} current={state === 'delivered'} text={t('so.stepDeliveredFull')} />
            </>
          )}
        </View>

        <Text style={st.heading} accessibilityRole="header">
          {t('so.linesOrdered')}
        </Text>
        {lines.map((l) => (
          <View key={l.line.soiId} style={st.line}>
            <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
              <Text style={st.lineName}>{nameOf(l)}</Text>
              <Text style={st.small}>{t('so.qtyRate', { qty: qtyText(num(l.line.soiOrderQty)), unit: unitOf(l), price: formatAmount(toPaise(l.line.soiRate) ?? 0) })}</Text>
            </View>
            <Text style={st.lineAmount}>{formatAmount(lineAmount(l.line))}</Text>
          </View>
        ))}
        <Text style={st.small}>{t('so.statusNote', { when: o.appSyncedOn ? when(o.appSyncedOn) : '—' })}</Text>
      </ScrollView>
      <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
        <Btn label={t('so.share')} tone="outline" onPress={share} />
        <Btn label={t('so.repeatOrder')} tone="primary" onPress={repeat} />
      </View>
      <CompanySheet visible={picking} onClose={() => setPicking(false)} onSwitched={repeat} />
    </View>
  );
}

function Lines({
  o,
  lines,
  nameOf,
  unitOf,
  itemsQty,
  total,
}: {
  o: SavedOrder;
  lines: SavedLine[];
  nameOf: (l: SavedLine) => string;
  unitOf: (l: SavedLine) => string;
  itemsQty: string;
  total: string;
}) {
  return (
    <View style={[st.card, { padding: 0, gap: 0, overflow: 'hidden' }]} accessibilityLabel={o.soCustName}>
      <View style={st.linesHead}>
        <Text style={st.rowTitle}>{itemsQty}</Text>
        <Text style={st.cellValue}>{total}</Text>
      </View>
      {lines.map((l) => (
        <View key={l.line.soiId} style={st.linesRow}>
          <Text style={[st.body14, { flex: 1 }]}>{nameOf(l)}</Text>
          <Text style={st.body14}>{`${qtyText(num(l.line.soiOrderQty))} ${unitOf(l)}`.trim()}</Text>
        </View>
      ))}
    </View>
  );
}

function Step({ text, at, done, current }: { text: string; at?: string; done?: boolean; current?: boolean }) {
  return (
    <View style={st.step} accessible accessibilityLabel={`${text}${at ? `, ${at}` : ''}`} accessibilityState={{ checked: !!done }}>
      <View style={[st.dot, done ? { backgroundColor: current ? '#3730A3' : '#166534' } : st.dotOpen]} />
      <Text style={[st.stepText, !done && { color: colors.textLabel }, current && { fontWeight: '600' }]}>{text}</Text>
      {at ? <Text style={st.small}>{at}</Text> : null}
    </View>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ flex: 1, gap: 4, alignItems: 'flex-start' }}>
      <Text style={st.small}>{label}</Text>
      {children}
    </View>
  );
}

function Badge({ icon, bg, fg, big }: { icon: IconName; bg: string; fg: string; big?: boolean }) {
  const size = big ? 56 : 36;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={big ? 28 : 18} color={fg} />
    </View>
  );
}

function Info({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={st.info}>
      <Ionicons name={icon} size={16} color={colors.textMuted} />
      <Text style={[st.small, { flex: 1, color: colors.textLabel }]}>{text}</Text>
    </View>
  );
}

function Btn({ label, tone, onPress, busy }: { label: string; tone: 'primary' | 'outline' | 'danger'; onPress: () => void; busy?: boolean }) {
  const fg = tone === 'primary' ? colors.onPrimary : tone === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: !!busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [st.btn, tone === 'primary' ? st.btnPrimary : tone === 'danger' ? st.btnDanger : st.btnOutline, pressed && { opacity: 0.85 }]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[st.btnText, { color: fg }]}>{label}</Text>}
    </Pressable>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xxl },
  body: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: spacing.md + 2, paddingHorizontal: spacing.lg, gap: 10 },
  center: { alignItems: 'center', paddingVertical: 20 },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md + 2,
    paddingRight: spacing.md,
  },
  bigTitle: { marginTop: spacing.xs, fontSize: 19, fontWeight: '600', color: colors.text },
  body15: { fontSize: font.md, lineHeight: 21, color: colors.text },
  body14: { fontSize: 14, color: colors.textLabel },
  small: { fontSize: 12.5, color: colors.textMuted },
  rowTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  heading: { marginTop: spacing.xs, fontSize: font.md, fontWeight: '600', color: colors.text },
  alertHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  alertTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.danger },
  info: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md + 2, padding: spacing.md },
  result: { fontSize: font.sm, color: colors.success, paddingHorizontal: spacing.xs },
  sendBtn: { minHeight: 44, minWidth: 96, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendText: { fontSize: 14, fontWeight: '600', color: colors.onPrimary },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 24 },
  dot: { width: 13, height: 13, borderRadius: 7 },
  dotOpen: { borderWidth: 2, borderColor: '#A8A29E' },
  stepText: { flex: 1, fontSize: 14, color: colors.text },
  summary: { flexDirection: 'row', gap: spacing.sm },
  cellValue: { fontSize: font.lg, fontWeight: '700', color: colors.text },
  chip: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  chipText: { fontSize: 12, fontWeight: '600' },
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
  lineAmount: { fontSize: 14, fontWeight: '600', color: colors.text },
  linesHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingVertical: spacing.md, paddingHorizontal: spacing.md + 2 },
  linesRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: 9, paddingHorizontal: spacing.md + 2, borderTopWidth: 1, borderTopColor: '#F1EDE4' },
  linkBtn: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  linkDanger: { fontSize: font.md, fontWeight: '600', color: colors.danger },
  footer: { flexDirection: 'row', gap: 10, paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  footerCol: { flexDirection: 'column' },
  footerRow: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, minHeight: 50, borderRadius: radius.md + 2, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  btnPrimary: { backgroundColor: colors.primary },
  btnOutline: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.inputBorder },
  btnDanger: { backgroundColor: colors.surface, borderWidth: 1, borderColor: '#FCA5A5' },
  btnText: { fontSize: font.md, fontWeight: '600', textAlign: 'center' },
});

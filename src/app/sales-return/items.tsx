import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import { PickerSheet } from '@/components/ui';
import { useDateNames } from '@/components/use-date-names';
import { itemName } from '@/features/orders/order-items';
import { num, qtyText } from '@/features/orders/order-math';
import { customerName } from '@/features/orders/queries';
import { returnAllBack, returnLinesCleared, returnReasonSet } from '@/features/returns/return-draft';
import { lineKeyOf, lineQtyCheck, partAmounts, returnEstimate, type ReturnPart } from '@/features/returns/return-math';
import { partFromBillLine, reasonCondition, useReturnSetup } from '@/features/returns/return-parts';
import { barStyles, CONDITION_TONES, returnStyles } from '@/features/returns/return-styles';
import { billLinesQuery, returnCustomerQuery, type BillLineRow } from '@/features/returns/queries';
import { formatDay } from '@/lib/date-range';
import { formatAmount } from '@/lib/money';
import { useAppDispatch, useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Return items, step 3 (canvas 6b): the reason, once for the whole return (VK Nex keeps one,
 * sr_reason_id; its default condition fills new lines), then the bill's lines with billed, back
 * before and can return, and the parts typed on each (quantity, condition, notes). All back fills
 * every line with what it can still take. With no bill, the items picked on No bill are listed.
 */
export default function ReturnItemsScreen() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const names = useDateNames();
  const dispatch = useAppDispatch();
  const d = useAppSelector((st) => st.returnDraft);
  const companyId = d.companyId ?? '';
  const [reasonOpen, setReasonOpen] = useState(false);
  const [showReturned, setShowReturned] = useState(false);

  const { reasons } = useReturnSetup(companyId);
  const { data: shop } = useLiveQuery(returnCustomerQuery(d.customerId ?? ''), [d.customerId]);
  const { data: lines } = useLiveQuery(billLinesQuery(d.bill?.sbId ?? '', d.bill?.accYear ?? ''), [d.bill?.sbId, d.bill?.accYear]);
  const reason = reasons.find((r) => r.reasonId === d.reasonId);
  const newCondition = reasonCondition(reason);
  const est = returnEstimate(d.parts);

  const partsOf = useMemo(() => {
    const m = new Map<string, ReturnPart[]>();
    for (const p of d.parts) m.set(lineKeyOf(p), [...(m.get(lineKeyOf(p)) ?? []), p]);
    return m;
  }, [d.parts]);
  const keyOf = (r: BillLineRow) => `${r.line.billItemId}|${r.line.accYear}`;
  const usable = lines.filter((r) => r.line.allowReturn);
  const open = usable.filter((r) => num(r.line.qtyLeftBase) > 0);
  const allBackRows = usable.filter((r) => num(r.line.qtyLeftBase) <= 0);
  const shownLines = showReturned ? usable : open;
  const overLines = lines.filter((r) => lineQtyCheck(partsOf.get(keyOf(r)) ?? [], r.line).over > 0);

  const pickReason = (id: string) => {
    const to = reasons.find((r) => r.reasonId === id);
    dispatch(returnReasonSet({ reasonId: id, from: reason ? reasonCondition(reason) : null, to: reasonCondition(to) }));
    setReasonOpen(false);
  };
  const allBack = () => {
    const add = open
      .filter((r) => !partsOf.has(keyOf(r)))
      .map((r) => partFromBillLine(r, newCondition, { qty: qtyText(num(r.line.qtyLeftBase) / (num(r.line.toBaseFactor) || 1)) }));
    dispatch(returnAllBack(add));
  };
  const clear = () =>
    Alert.alert(t('sr.items.clearTitle'), t('sr.items.clearText'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('sr.items.clear'), style: 'destructive', onPress: () => dispatch(returnLinesCleared()) },
    ]);
  const openLine = (lineKey: string) => router.push({ pathname: '/sales-return/line', params: { lineKey } });
  const next = () => {
    if (!d.reasonId) return Alert.alert(t('sr.items.reasonNeededTitle'), t('sr.items.reasonNeeded'));
    if (est.parts === 0) return Alert.alert(t('sr.items.nothingTitle'), t('sr.items.nothing'));
    if (overLines.length) return Alert.alert(t('sr.items.tooManyTitle'), t('sr.items.tooMany', { items: overLines.map((r) => itemName({ itemNameEn: r.nameEn ?? r.line.itemName ?? '', itemNameTa: r.nameTa }, i18n.language)).join(', ') }));
    router.push('/sales-return/review');
  };

  const shopName = shop[0] ? customerName(shop[0]) : '';
  const subtitle = d.bill ? `${d.bill.refno} · ${formatDay(d.bill.date, names).replace(/ \d{4}$/, '')} · ${shopName}` : `${t('sr.items.noBill')} · ${shopName}`;
  const noBillParts = d.parts.filter((p) => !p.billItemId);

  return (
    <View style={st.root}>
      <ScreenHeader title={t('sr.items.title')} subtitle={subtitle} backLabel={t('sr.back')} />
      <ScrollView contentContainerStyle={st.body}>
        <View style={{ gap: 6 }}>
          <Text style={st.label}>{t('sr.items.why')} *</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`${t('sr.items.why')}: ${reason?.name ?? t('sr.items.pickReason')}`} onPress={() => setReasonOpen(true)} style={[st.select, !d.reasonId && { borderColor: colors.primary }]}>
            <Text style={[st.selectText, !reason && { color: colors.textMuted, fontWeight: '400' }]} numberOfLines={1}>
              {reason?.name ?? t('sr.items.pickReason')}
            </Text>
            {reason ? <Text style={[st.chip, { backgroundColor: CONDITION_TONES[newCondition].bg, color: CONDITION_TONES[newCondition].fg }]}>{t('sr.items.newLines', { condition: t(`sr.condition.${newCondition}`) })}</Text> : null}
            <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
          </Pressable>
          <Text style={st.hint}>{reasons.length ? t('sr.items.reasonHint') : t('sr.items.noReasons')}</Text>
        </View>

        {d.bill ? (
          <>
            <View style={st.listHead}>
              <Text style={st.h2}>{t('sr.items.billLines', { open: open.length, all: lines.length })}</Text>
              <View style={{ flexDirection: 'row' }}>
                <Pressable accessibilityRole="button" onPress={allBack} style={st.textBtn}>
                  <Text style={st.textBtnMain}>{t('sr.items.allBack')}</Text>
                </Pressable>
                {d.parts.length ? (
                  <Pressable accessibilityRole="button" onPress={clear} style={st.textBtn}>
                    <Text style={st.textBtnQuiet}>{t('sr.items.clear')}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
            {shownLines.map((r) => {
              const k = keyOf(r);
              const parts = partsOf.get(k) ?? [];
              const check = lineQtyCheck(parts, r.line);
              const name = itemName({ itemNameEn: r.nameEn ?? r.line.itemName ?? '', itemNameTa: r.nameTa }, i18n.language);
              const unit = r.line.unitName ?? '';
              const factor = num(r.line.toBaseFactor) || 1;
              const inUnit = (base: string | number) => qtyText(num(String(base)) / factor);
              const net = parts.reduce((s, p) => s + partAmounts(p).netPaise, 0);
              const allGone = num(r.line.qtyLeftBase) <= 0;
              if (!parts.length) {
                return (
                  <View key={k} style={[st.row, allGone && { opacity: 0.6 }]}>
                    <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                      <Text style={st.itemName} numberOfLines={2}>
                        {name} {r.line.isFree ? <Text style={st.free}> {t('sr.items.free')} </Text> : null}
                      </Text>
                      <Text style={st.small}>
                        {allGone
                          ? t('sr.items.allBackLine')
                          : r.line.isFree
                            ? t('sr.items.canReturnFree', { qty: inUnit(r.line.qtyLeftBase), unit })
                            : t('sr.items.canReturnRate', { qty: inUnit(r.line.qtyLeftBase), unit, rate: formatAmount(Math.round(num(r.line.ratePreTaxBase) * factor * 100)), gst: qtyText(num(r.line.taxPerc)) })}
                      </Text>
                    </View>
                    {!allGone ? (
                      <Pressable accessibilityRole="button" accessibilityLabel={t('sr.items.returnThis', { name })} onPress={() => openLine(k)} style={st.plus}>
                        <Text style={st.plusText}>+</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              }
              return (
                <Pressable key={k} accessibilityRole="button" onPress={() => openLine(k)} style={({ pressed }) => [st.lineCard, check.over > 0 && { borderColor: colors.danger }, pressed && { backgroundColor: colors.bg }]}>
                  <View style={st.between}>
                    <Text style={[st.itemName, { flex: 1 }]} numberOfLines={2}>
                      {name}
                    </Text>
                    <Text style={st.amount}>{formatAmount(net)}</Text>
                  </View>
                  <Text style={st.small}>{t('sr.items.billedLine', { billed: inUnit(r.line.billQtyBase), back: inUnit(r.line.returnedQtyBase), left: inUnit(r.line.qtyLeftBase), unit })}</Text>
                  {r.line.batchNo ? <Text style={st.small}>{t('sr.items.batch', { batch: r.line.batchNo, exp: r.line.expiryDate ? r.line.expiryDate.slice(5, 7) + '/' + r.line.expiryDate.slice(2, 4) : '—' })}</Text> : null}
                  {num(r.line.onOtherDraftsBase) > 0 ? <Text style={[st.chip, st.chipHeld]}>{t('sr.items.onDrafts', { qty: inUnit(r.line.onOtherDraftsBase) })}</Text> : null}
                  <View style={st.parts}>
                    {parts.map((p) => (
                      <View key={p.key} style={st.between}>
                        <Text style={st.partText} numberOfLines={1}>
                          {p.splitNo > 0 ? '↳ ' : ''}
                          <Text style={{ fontWeight: '700' }}>{`${qtyText(num(p.qty))} ${p.unitName}`}</Text> ·{' '}
                          <Text style={{ color: CONDITION_TONES[p.condition].fg, fontWeight: '600' }}>{t(`sr.condition.${p.condition}`)}</Text>
                          {p.notes ? ` · ${p.notes}` : ''}
                        </Text>
                        <Text style={st.partText}>{formatAmount(partAmounts(p).netPaise)}</Text>
                      </View>
                    ))}
                  </View>
                  {check.over > 0 ? <Text style={st.error}>{t('sr.items.overBy', { qty: inUnit(check.over), unit })}</Text> : null}
                </Pressable>
              );
            })}
            {allBackRows.length > 0 ? (
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: showReturned }} onPress={() => setShowReturned((v) => !v)} style={st.check}>
                <Ionicons name={showReturned ? 'checkbox' : 'square-outline'} size={22} color={colors.primary} />
                <Text style={st.checkText}>{t('sr.items.showReturned', { n: allBackRows.length })}</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <>
            <View style={st.listHead}>
              <Text style={st.h2}>{t('sr.items.noBillItems', { n: noBillParts.length })}</Text>
              <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/sales-return/no-bill', params: { from: 'items' } })} style={st.textBtn}>
                <Text style={st.textBtnMain}>{t('sr.items.addItems')}</Text>
              </Pressable>
            </View>
            {noBillParts.map((p) => (
              <Pressable key={p.key} accessibilityRole="button" onPress={() => openLine(p.key)} style={({ pressed }) => [st.lineCard, pressed && { backgroundColor: colors.bg }]}>
                <View style={st.between}>
                  <Text style={[st.itemName, { flex: 1 }]} numberOfLines={2}>
                    {itemName({ itemNameEn: p.name, itemNameTa: p.nameTa }, i18n.language)}
                  </Text>
                  <Text style={st.amount}>{formatAmount(partAmounts(p).netPaise)}</Text>
                </View>
                <Text style={st.small}>{p.rateSource === 'LAST_SALE' ? t('sr.noBill.lastSaleShort', { bill: p.rateFrom ?? '' }) : t('sr.noBill.todayShort')}</Text>
                <Text style={st.partText}>
                  <Text style={{ fontWeight: '700' }}>{`${qtyText(num(p.qty))} ${p.unitName}`}</Text> ·{' '}
                  <Text style={{ color: CONDITION_TONES[p.condition].fg, fontWeight: '600' }}>{t(`sr.condition.${p.condition}`)}</Text>
                  {p.batchNo ? ` · ${t('sr.items.batchOnly', { batch: p.batchNo })}` : ''}
                </Text>
              </Pressable>
            ))}
            {noBillParts.length === 0 ? <Text style={st.empty}>{t('sr.items.noItemsYet')}</Text> : null}
          </>
        )}
      </ScrollView>

      <View style={[barStyles.bar, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={barStyles.barSmall}>{t('sr.items.barQty', { qty: qtyText(est.qty), good: qtyText(est.goodQty), other: qtyText(est.qty - est.goodQty) })}</Text>
          <Text style={barStyles.barTotal}>{formatAmount(est.exactPaise)}</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={next} style={({ pressed }) => [barStyles.barBtn, pressed && { opacity: 0.85 }]}>
          <Text style={barStyles.barBtnText}>{t('sr.items.next')}</Text>
        </Pressable>
      </View>

      <PickerSheet
        visible={reasonOpen}
        title={t('sr.items.why')}
        value={d.reasonId ?? ''}
        options={reasons.map((r) => ({ value: r.reasonId, label: r.name }))}
        onPick={pickReason}
        onClose={() => setReasonOpen(false)}
      />
    </View>
  );
}

const st = StyleSheet.create({
  ...returnStyles,
  label: { fontSize: font.sm, fontWeight: '500', color: colors.textLabel },
  select: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md + 2, borderWidth: 1, borderColor: colors.inputBorder, borderRadius: radius.md + 2, backgroundColor: colors.surface },
  selectText: { flex: 1, fontSize: font.md, fontWeight: '600', color: colors.text },
  listHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  h2: { fontSize: font.md, fontWeight: '600', color: colors.text },
  textBtn: { minHeight: 40, paddingHorizontal: 10, justifyContent: 'center' },
  textBtnMain: { fontSize: font.sm, fontWeight: '600', color: colors.primary },
  textBtnQuiet: { fontSize: font.sm, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md + 2, paddingVertical: 10, paddingHorizontal: spacing.md + 2 },
  itemName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  free: { fontSize: 12, fontWeight: '600', color: '#6B21A8', backgroundColor: '#F3E8FF' },
  plus: { width: 44, height: 44, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  plusText: { fontSize: 20, fontWeight: '600', color: colors.primary },
  lineCard: { gap: 6, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.primary, borderRadius: radius.md + 2, paddingVertical: 10, paddingHorizontal: spacing.md + 2 },
  amount: { fontSize: font.md, fontWeight: '700', color: colors.text },
  parts: { gap: 4, borderTopWidth: 1, borderTopColor: '#F1EDE4', paddingTop: 6 },
  partText: { fontSize: 13.5, color: colors.text, flexShrink: 1 },
  chipHeld: { alignSelf: 'flex-start', backgroundColor: '#EDE9FE', color: '#5B21B6' },
  error: { fontSize: 12.5, fontWeight: '600', color: colors.danger },
  check: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  checkText: { fontSize: 14, color: colors.textLabel },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xl },
});

import { FlashList } from '@shopify/flash-list';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import { Button, Card, Field, Row, s } from '@/components/ui';
import { getMeta } from '@/db/meta';
import type { Item } from '@/db/schema';
import { computeBill, isInterState } from '@/domain/pricing';
import { masterQueries } from '@/features/masters/queries';
import { createOrder, resolveRate, type DraftLine } from '@/features/orders/order-repo';
import { formatINR } from '@/lib/money';
import { useAppSelector } from '@/store';
import { colors, radius, spacing } from '@/theme';

interface CartLine extends DraftLine {
  item: Item;
}

export default function NewOrderScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { customerId = '' } = useLocalSearchParams<{ customerId?: string }>();
  const userId = useAppSelector((st) => st.session.session?.userId ?? null);
  const secondUserId = useAppSelector((st) => st.session.session?.secondUserId ?? null);
  // Seller's GST state, sent by VK Nex at the last Sync. Decides CGST+SGST vs IGST.
  const [companyStateCode] = useState(() => getMeta('companyStateCode'));

  const { data: custRows } = useLiveQuery(masterQueries.customerById(customerId), [customerId]);
  const customer = custRows[0];

  const [search, setSearch] = useState('');
  const { data: itemResults } = useLiveQuery(masterQueries.items(search, 30), [search]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [saving, setSaving] = useState(false);

  const interState = isInterState(companyStateCode, customer?.stateCode);
  const bill = useMemo(
    () =>
      computeBill(
        cart.map((l) => ({
          qty: l.qty,
          ratePaise: l.ratePaise,
          discBp: l.discBp,
          gstRateBp: l.item.gstRateBp,
          cessRateBp: l.item.cessRateBp,
          taxInclusive: l.item.taxInclusive,
        })),
        interState,
      ),
    [cart, interState],
  );

  const addItem = (item: Item) => {
    setCart((prev) => {
      const i = prev.findIndex((l) => l.itemId === item.id);
      if (i >= 0) return prev.map((l, idx) => (idx === i ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { itemId: item.id, item, qty: 1, ratePaise: resolveRate(item, customer?.priceLevel ?? null) }];
    });
    setSearch('');
  };

  const setQty = (itemId: string, qty: number) =>
    setCart((prev) => (qty > 0 ? prev.map((l) => (l.itemId === itemId ? { ...l, qty } : l)) : prev.filter((l) => l.itemId !== itemId)));

  const save = () => {
    if (!customer || !cart.length || !userId) return;
    setSaving(true);
    try {
      createOrder({
        customerId: customer.id,
        createdBy: userId,
        secondUserId,
        companyStateCode,
        lines: cart.map(({ itemId, qty, ratePaise, discBp }) => ({ itemId, qty, ratePaise, discBp })),
      });
      Alert.alert(t('orders.new'), t('orders.saved'));
      router.back();
    } catch (e) {
      Alert.alert(t('common.error'), e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!customer) return <View style={s.screen} />;

  return (
    <View style={s.screen}>
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <Card style={{ padding: spacing.md }}>
          <Text style={[s.body, { fontWeight: '700' }]}>{customer.name}</Text>
          <Text style={s.muted}>
            {customer.gstin ?? 'Unregistered'} · {interState ? 'IGST' : 'CGST+SGST'}
            {customer.outstandingPaise > 0 ? ` · Due ${formatINR(customer.outstandingPaise)}` : ''}
          </Text>
        </Card>
        <Field placeholder={t('orders.addItem')} value={search} onChangeText={setSearch} autoCorrect={false} style={{ marginBottom: 0 }} />
      </View>

      {search.trim() ? (
        <FlashList
          data={itemResults}
          keyExtractor={(i) => i.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable style={s.listRow} onPress={() => addItem(item)}>
              <Text style={s.body}>{item.name}</Text>
              <Text style={s.muted}>
                {item.code ?? ''} · GST {item.gstRateBp / 100}% · MRP {formatINR(item.mrpPaise)}
              </Text>
            </Pressable>
          )}
        />
      ) : (
        <FlashList
          data={cart}
          keyExtractor={(l) => l.itemId}
          renderItem={({ item: l, index }) => (
            <View style={s.listRow}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.body}>{l.item.name}</Text>
                  <Text style={s.muted}>
                    {formatINR(l.ratePaise)} × {l.qty} = {formatINR(bill.lines[index]?.totalPaise ?? 0)}
                  </Text>
                </View>
                <QtyStepper value={l.qty} onChange={(q) => setQty(l.itemId, q)} />
              </Row>
            </View>
          )}
        />
      )}

      <View style={{ padding: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={s.muted}>
            {t('orders.taxable')} {formatINR(bill.taxablePaise)} · {t('orders.tax')} {formatINR(bill.taxPaise)}
          </Text>
          <Text style={[s.title, { color: colors.primary }]}>{formatINR(bill.totalPaise)}</Text>
        </Row>
        <Button title={t('orders.save')} onPress={save} loading={saving} disabled={!cart.length} style={{ marginTop: spacing.sm }} />
      </View>
    </View>
  );
}

function QtyStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const btn = { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' } as const;
  return (
    <Row style={{ gap: 6 }}>
      <Pressable style={btn} onPress={() => onChange(value - 1)}>
        <Text style={{ fontSize: 20, color: colors.primary }}>−</Text>
      </Pressable>
      <TextInput
        value={String(value)}
        keyboardType="decimal-pad"
        onChangeText={(v) => {
          const n = Number(v);
          if (Number.isFinite(n)) onChange(n);
        }}
        style={{ width: 52, textAlign: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, height: 36 }}
      />
      <Pressable style={btn} onPress={() => onChange(value + 1)}>
        <Text style={{ fontSize: 20, color: colors.primary }}>+</Text>
      </Pressable>
    </Row>
  );
}

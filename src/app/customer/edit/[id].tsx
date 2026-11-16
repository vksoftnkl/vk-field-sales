import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, TextField } from '@/components/ui';
import { addressLine } from '@/features/customers/customer-list';
import {
  changedEditFields,
  cleanCustomerEdit,
  validateCustomerEdit,
  type CustomerEditForm,
  type EditField,
  type FieldError,
} from '@/features/customers/new-customer';
import { customerDetailQuery, saveCustomerEdit } from '@/features/customers/queries';
import { useAppSelector } from '@/store';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Edit customer (the Qt app's CustomerUpdate.qml): the two mobiles, Aadhaar and PAN. Name and
 * address stay as VK Nex has them. Saved on the phone (works offline); the next Sync sends it.
 */
export default function EditCustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = useAppSelector((st) => st.session.session?.userId ?? '');

  // Read once: the form keeps what the salesman types, even if a Sync changes the row meanwhile.
  const [c] = useState(() => customerDetailQuery(id).get());
  const [original] = useState<CustomerEditForm>(() => ({
    cusPhone1: c?.cusPhone1 ?? '',
    cusPhone2: c?.cusPhone2 ?? '',
    cusAadharNo: c?.cusAadharNo ?? '',
    cusPanNo: c?.cusPanNo ?? '',
  }));
  const [form, setForm] = useState<CustomerEditForm>(original);
  const [submitted, setSubmitted] = useState(false);
  const saved = useRef(false);

  const errors: Partial<Record<EditField, FieldError>> = submitted ? validateCustomerEdit(form, original) : {};
  const err = (f: EditField) => (errors[f] ? t(`newCustomer.errors.${errors[f]}`) : undefined);
  const set = (f: EditField) => (v: string) => setForm((x) => ({ ...x, [f]: v }));

  const save = () => {
    if (saved.current || !c) return;
    setSubmitted(true);
    if (Object.keys(validateCustomerEdit(form, original)).length > 0) return;
    try {
      saveCustomerEdit(id, cleanCustomerEdit(form), changedEditFields(form, original), userId);
      saved.current = true;
      router.back();
    } catch {
      Alert.alert(t('common.error'));
    }
  };

  const name = c ? (c.cusName ?? c.cusShort ?? c.cusCode ?? '') : '';

  return (
    <View style={st.root}>
      <View style={[st.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('editCustomer.back')} onPress={() => router.back()} style={st.back}>
          <Ionicons name="chevron-back" size={24} color={colors.onPrimary} />
        </Pressable>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={st.title} accessibilityRole="header">
            {t('editCustomer.title')}
          </Text>
          {name ? (
            <Text style={st.subtitle} numberOfLines={1}>
              {name}
            </Text>
          ) : null}
        </View>
      </View>

      {!c ? (
        <Text style={st.empty}>{t('customerDetail.notFound')}</Text>
      ) : (
        <>
          <View style={st.note}>
            <Ionicons name="cloud-upload-outline" size={16} color="#1E40AF" />
            <Text style={st.noteText}>{t('editCustomer.note')}</Text>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
            <ScrollView contentContainerStyle={st.form} keyboardShouldPersistTaps="handled">
              <View style={st.fixed}>
                <Text style={st.fixedLabel}>{t('editCustomer.fixed')}</Text>
                <Text style={st.fixedName}>{name}</Text>
                {addressLine(c) ? <Text style={st.fixedAddr}>{addressLine(c)}</Text> : null}
              </View>
              <TextField
                label={t('editCustomer.phone1')}
                value={form.cusPhone1}
                onChangeText={set('cusPhone1')}
                error={err('cusPhone1')}
                placeholder={t('newCustomer.mobileHint')}
                keyboardType="phone-pad"
                maxLength={16}
              />
              <TextField
                label={t('editCustomer.phone2')}
                value={form.cusPhone2}
                onChangeText={set('cusPhone2')}
                error={err('cusPhone2')}
                keyboardType="phone-pad"
                maxLength={16}
              />
              <TextField
                label={t('editCustomer.aadhaar')}
                value={form.cusAadharNo}
                onChangeText={set('cusAadharNo')}
                error={err('cusAadharNo')}
                placeholder={t('editCustomer.aadhaarHint')}
                keyboardType="number-pad"
                maxLength={14}
              />
              <TextField
                label={t('editCustomer.pan')}
                value={form.cusPanNo}
                onChangeText={set('cusPanNo')}
                error={err('cusPanNo')}
                placeholder={t('editCustomer.panHint')}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={10}
              />
            </ScrollView>
            <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
              <Button title={t('editCustomer.save')} onPress={save} style={{ height: 52 }} />
            </View>
          </KeyboardAvoidingView>
        </>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.primary, paddingLeft: spacing.sm, paddingRight: spacing.md, paddingBottom: spacing.md + 2 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '600', color: colors.onPrimary },
  subtitle: { marginTop: 2, fontSize: font.sm, color: colors.onPrimaryMuted },
  empty: { textAlign: 'center', fontSize: font.md, color: colors.textMuted, padding: spacing.xxl },
  note: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#DBEAFE', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2 },
  noteText: { flex: 1, fontSize: font.sm, fontWeight: '500', color: '#1E40AF' },
  form: { padding: spacing.lg, gap: spacing.xs },
  fixed: { backgroundColor: '#EEECE9', borderRadius: radius.lg - 2, paddingHorizontal: spacing.md + 2, paddingVertical: spacing.md, gap: 3, marginBottom: spacing.md },
  fixedLabel: { fontSize: 12, color: colors.textMuted },
  fixedName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  fixedAddr: { fontSize: font.sm, color: colors.textLabel },
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});

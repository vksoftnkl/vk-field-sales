import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View, type TextInputProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, SelectField, TextField, type SelectOption } from '@/components/ui';
import { getMeta } from '@/db/meta';
import {
  cleanNewCustomer,
  emptyNewCustomer,
  GST_TYPES,
  gstinAllowed,
  requiredFields,
  validateNewCustomer,
  type FieldError,
  type FormField,
  type NewCustomerForm,
} from '@/features/customers/new-customer';
import { addCustomer, beatsQuery, customerNameExists, customerTypesQuery, existingBeatIds } from '@/features/customers/queries';
import { GST_STATES, HOME_STATE_CODE } from '@/lib/gst-states';
import { parseIdList } from '@/lib/selection';
import { useAppSelector } from '@/store';
import { colors, font, spacing } from '@/theme';

/**
 * New customer, in the approved layout. Fields are VK Nex's customer fields (cus_*) and the
 * checks are the server's, so the shop is accepted at upload. Saved on the phone (works
 * offline) and marked for the next Upload.
 */
export default function NewCustomerScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const userId = useAppSelector((st) => st.session.session?.userId ?? '');

  const { data: beatRows } = useLiveQuery(beatsQuery());
  const { data: typeRows } = useLiveQuery(customerTypesQuery());
  const beatOptions: SelectOption[] = useMemo(() => beatRows.map((b) => ({ value: b.id, label: b.name })), [beatRows]);
  const typeOptions: SelectOption[] = useMemo(() => typeRows.map((ty) => ({ value: ty.id, label: ty.name })), [typeRows]);
  const stateOptions: SelectOption[] = useMemo(() => GST_STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` })), []);
  const gstOptions: SelectOption[] = useMemo(() => GST_TYPES.map((g) => ({ value: g, label: t(`newCustomer.gstTypes.${g}`) })), [t]);

  // A new shop is usually in the beat being worked today: start there if exactly one is ticked.
  const [form, setForm] = useState<NewCustomerForm>(() => {
    const beats = existingBeatIds(parseIdList(getMeta('lastBeatIds')));
    return { ...emptyNewCustomer(HOME_STATE_CODE), cusAreaId: beats.length === 1 ? beats[0]! : '' };
  });
  const [submitted, setSubmitted] = useState(false);
  /** Found only on Save (it reads the database), and cleared once the name is edited. */
  const [nameTaken, setNameTaken] = useState(false);
  // A quick double tap must not save the shop twice while the page is closing.
  const saved = useRef(false);

  const set = (field: FormField) => (value: string) => {
    if (field === 'cusName') setNameTaken(false);
    setForm((f) => ({ ...f, [field]: value }));
  };
  const required = requiredFields(form.cusGstType);
  // Errors appear after the first Save, then follow the typing.
  const errors: Partial<Record<FormField, FieldError>> = submitted ? validateNewCustomer(form) : {};
  if (nameTaken && !errors.cusName) errors.cusName = 'nameExists';
  const hasErrors = Object.keys(errors).length > 0;

  const err = (field: FormField) => {
    const e = errors[field];
    return e ? t(`newCustomer.errors.${e}`) : undefined;
  };
  const text = (field: FormField, label: string, props?: TextInputProps) => (
    <TextField
      label={label}
      required={required.has(field)}
      value={form[field]}
      onChangeText={set(field)}
      error={err(field)}
      autoCorrect={false}
      {...props}
    />
  );

  const save = () => {
    if (saved.current) return;
    setSubmitted(true);
    if (Object.keys(validateNewCustomer(form)).length > 0) return;
    const clean = cleanNewCustomer(form);
    if (customerNameExists(clean.cusName)) return setNameTaken(true);
    try {
      addCustomer(clean, userId);
      saved.current = true;
      router.back(); // the list shows the new shop, and Upload counts it
    } catch {
      Alert.alert(t('common.error'));
    }
  };

  return (
    <View style={st.root}>
      <View style={[st.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('newCustomer.back')} onPress={() => router.back()} style={st.back}>
          <Ionicons name="chevron-back" size={24} color={colors.onPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={st.title} accessibilityRole="header">
            {t('newCustomer.title')}
          </Text>
          <Text style={st.subtitle}>{t('newCustomer.requiredNote')}</Text>
        </View>
      </View>

      {/* 'padding' on Android too: the app is edge-to-edge, so the window no longer resizes for the keyboard. */}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.form} keyboardShouldPersistTaps="handled">
          <Section title={t('newCustomer.sectionShop')}>
            {text('cusName', t('newCustomer.name'), { autoCapitalize: 'words', maxLength: 200 })}
            <Pair>
              <SelectField
                label={t('newCustomer.type')}
                required
                value={form.cusGroupId}
                options={typeOptions}
                onChange={set('cusGroupId')}
                placeholder={t('newCustomer.choose')}
                error={err('cusGroupId')}
              />
              <SelectField
                label={t('newCustomer.beat')}
                required
                value={form.cusAreaId}
                options={beatOptions}
                onChange={set('cusAreaId')}
                placeholder={t('newCustomer.choose')}
                searchable
                error={err('cusAreaId')}
              />
            </Pair>
            {text('cusContactPerson', t('newCustomer.contactPerson'), { autoCapitalize: 'words', maxLength: 150 })}
          </Section>

          <Section title={t('newCustomer.sectionAddress')}>
            {text('cusAddr1', t('newCustomer.addr1'), { placeholder: t('newCustomer.addr1Hint'), maxLength: 250 })}
            {text('cusAddr2', t('newCustomer.addr2'), { maxLength: 250 })}
            {text('cusLandmark', t('newCustomer.landmark'), { maxLength: 200 })}
            <Pair>
              {text('cusCity', t('newCustomer.city'), { autoCapitalize: 'words', maxLength: 250 })}
              {text('cusDistrict', t('newCustomer.district'), { autoCapitalize: 'words', maxLength: 250 })}
            </Pair>
            <Pair>
              <SelectField
                label={t('newCustomer.state')}
                required
                value={form.cusStateCode}
                options={stateOptions}
                onChange={set('cusStateCode')}
                placeholder={t('newCustomer.choose')}
                searchable
                error={err('cusStateCode')}
              />
              {text('cusPin', t('newCustomer.pincode'), { keyboardType: 'number-pad', maxLength: 7 })}
            </Pair>
          </Section>

          <Section title={t('newCustomer.sectionContact')}>
            <Pair>
              {text('cusPhone1', t('newCustomer.phone1'), { keyboardType: 'phone-pad', placeholder: t('newCustomer.mobileHint'), maxLength: 16 })}
              {text('cusPhone2', t('newCustomer.phone2'), { keyboardType: 'phone-pad', maxLength: 20 })}
            </Pair>
            {text('cusWhatsappNo', t('newCustomer.whatsapp'), { keyboardType: 'phone-pad', maxLength: 16 })}
            {text('cusEmail', t('newCustomer.email'), { keyboardType: 'email-address', autoCapitalize: 'none', maxLength: 120 })}
          </Section>

          <Section title={t('newCustomer.sectionTax')}>
            <SelectField label={t('newCustomer.gstType')} value={form.cusGstType} options={gstOptions} onChange={set('cusGstType')} />
            {/* The server refuses a GSTIN for Unregistered / Overseas, so the field shows only when it is wanted. */}
            {gstinAllowed(form.cusGstType)
              ? text('cusGstNo', t('newCustomer.gstin'), { autoCapitalize: 'characters', placeholder: t('newCustomer.gstinHint'), maxLength: 15 })
              : null}
            <Pair>
              {text('cusPanNo', t('newCustomer.pan'), { autoCapitalize: 'characters', maxLength: 10 })}
              {text('cusAadharNo', t('newCustomer.aadhaar'), { keyboardType: 'number-pad', maxLength: 14 })}
            </Pair>
          </Section>
        </ScrollView>

        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          {hasErrors ? (
            <Text style={st.footerError} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {t('newCustomer.fixErrors')}
            </Text>
          ) : null}
          <Button title={t('newCustomer.save')} onPress={save} style={{ height: 52 }} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Text style={st.section} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </>
  );
}

/** Two fields side by side, each half the width. */
function Pair({ children }: { children: [ReactNode, ReactNode] }) {
  return (
    <View style={st.pair}>
      <View style={st.half}>{children[0]}</View>
      <View style={st.half}>{children[1]}</View>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md,
    paddingBottom: spacing.md + 2,
  },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '600', color: colors.onPrimary },
  subtitle: { marginTop: 2, fontSize: font.sm, color: colors.onPrimaryMuted },
  form: { padding: spacing.lg },
  section: {
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    fontSize: font.sm,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.primary,
    textTransform: 'uppercase',
  },
  pair: { flexDirection: 'row', gap: spacing.sm + 2 },
  half: { flex: 1, minWidth: 0 },
  footer: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerError: { marginBottom: spacing.sm, fontSize: font.sm, color: colors.danger, textAlign: 'center' },
});

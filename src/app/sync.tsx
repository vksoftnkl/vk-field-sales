import Ionicons from '@expo/vector-icons/Ionicons';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { forgetRefusedLoginPassword } from '@/auth/auth-service';
import { Button, PasswordField, TextField } from '@/components/ui';
import { toPaise } from '@/features/orders/order-math';
import { waitingReceiptsQuery } from '@/features/receipts/queries';
import { waitingReturnsQuery } from '@/features/returns/queries';
import { waitingBillsQuery } from '@/features/sales/queries';
import { formatAmount } from '@/lib/money';
import { getServerCredentials, setServerCredentials } from '@/sync/credentials';
import { runSync, testConnection, type SyncReport, type SyncStep } from '@/sync/run-sync';
import { formatServerAddress, parseServerAddress } from '@/sync/server-address';
import { isLedgerStepError } from '@/sync/download-ledgers';
import { getDeviceUid, getServerAddress, saveServerAddress, waitingOrdersQuery, waitingToSendQuery, waitingVisitsQuery } from '@/sync/sync-store';
import { isApiError, isNetworkError, isRouteMissing } from '@/sync/vk-nex-api';
import { colors, font, radius, spacing } from '@/theme';

type Check = { ok: boolean; text: string } | null;

/**
 * Sync with the VK Nex server PC on the office LAN, only when the salesman taps it. Sends every
 * customer added, every edit, order and check-in made on the phone (each is marked synced as soon
 * as VK Nex has it), then brings VK Nex's customers, companies, items and ledgers to the phone.
 */
export default function SyncScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [address, setAddress] = useState(() => {
    const saved = getServerAddress();
    return saved ? formatServerAddress(saved) : '';
  });
  const [addressError, setAddressError] = useState<string>();
  const [check, setCheck] = useState<Check>(null);
  const [testing, setTesting] = useState(false);

  // VK Nex sign-in: the phone login's user, unless the salesman types another one here.
  const [showSignIn, setShowSignIn] = useState(() => getServerCredentials() === null);
  const [loginName, setLoginName] = useState(() => getServerCredentials()?.loginName ?? '');
  const [password, setPassword] = useState('');

  const [progress, setProgress] = useState<string | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const { data: pending } = useLiveQuery(waitingToSendQuery());
  const { data: waitingOrders } = useLiveQuery(waitingOrdersQuery());
  const { data: waitingVisits } = useLiveQuery(waitingVisitsQuery());
  const { data: bills } = useLiveQuery(waitingBillsQuery());
  const { data: returns } = useLiveQuery(waitingReturnsQuery());
  const { data: waitingReceipts } = useLiveQuery(waitingReceiptsQuery());
  const [deviceUid] = useState(getDeviceUid);
  const waitingCount = pending.length + waitingOrders.length + waitingVisits.length + waitingReceipts.length;

  /** No answer from VK Nex; for https the cause may also be a certificate the phone doesn't trust. */
  const noAnswer = (shown: string) => t(/^https:\/\//i.test(shown) ? 'sync.noAnswerHttps' : 'sync.noAnswer', { address: shown });

  /** Reads and saves the address box; null (with the error shown) when it is not usable. */
  const takeAddress = () => {
    const a = parseServerAddress(address);
    if (!a) {
      setAddressError(t('sync.addressInvalid'));
      return null;
    }
    setAddressError(undefined);
    setAddress(formatServerAddress(a));
    saveServerAddress(a);
    return a;
  };

  const test = async () => {
    const a = takeAddress();
    if (!a) return;
    setTesting(true);
    setCheck(null);
    try {
      await testConnection(a);
      setCheck({ ok: true, text: t('sync.connected', { address: formatServerAddress(a) }) });
    } catch (e) {
      setCheck({ ok: false, text: isNetworkError(e) ? noAnswer(formatServerAddress(a)) : t('sync.server', { message: errorText(e) }) });
    } finally {
      setTesting(false);
    }
  };

  const stepText = (step: SyncStep, done = 0, total = 0) => {
    const n = Math.min(done + 1, total);
    switch (step) {
      case 'signIn':
        return t('sync.stepSignIn');
      case 'masters':
        return t('sync.stepMasters');
      case 'upload':
        return total ? t('sync.stepUpload', { n, total }) : t('sync.stepUploadNone');
      case 'update':
        return total ? t('sync.stepUpdate', { n, total }) : t('sync.stepUpdateNone');
      case 'orders':
        return total ? t('sync.stepOrders', { n, total }) : t('sync.stepOrdersNone');
      case 'visits':
        return total ? t('sync.stepVisits', { n, total }) : t('sync.stepVisitsNone');
      case 'receipts':
        return total ? t('sync.stepReceipts', { n, total }) : t('sync.stepReceiptsNone');
      case 'receiptData':
        return total ? t('sync.stepReceiptData', { n, total }) : t('sync.stepReceiptDataNone');
      case 'items':
        return total ? t('sync.stepItems', { n, total }) : t('sync.stepItemsNone');
      case 'branches':
        return t('sync.stepBranches');
      case 'download':
        return total ? t('sync.stepDownload', { n, total }) : t('sync.stepDownloadList');
      case 'ledger':
        return total ? t('sync.stepLedger', { n, total }) : t('sync.stepLedgerYears');
    }
  };

  const sync = async () => {
    if (progress) return;
    const a = takeAddress();
    if (!a) return;
    if (showSignIn) {
      if (!loginName.trim() || !password) return setReport({ outcomes: [], updates: [], stoppedBy: new Error('NO_SIGN_IN'), stoppedAt: 'signIn' });
      setServerCredentials({ loginName: loginName.trim(), password });
    }
    setReport(null);
    setCheck(null);
    setProgress(stepText('signIn'));
    try {
      const r = await runSync((step, done, total) => setProgress(stepText(step, done, total)));
      setReport(r);
      // VK Nex refused the sign-in: let the salesman type the VK Nex user and password.
      if (r.stoppedAt === 'signIn' && isApiError(r.stoppedBy) && r.stoppedBy.status === 401) {
        // If it was the login's own password, the phone stops accepting it too.
        forgetRefusedLoginPassword();
        setShowSignIn(true);
        setPassword('');
      } else if (!r.stoppedBy) {
        setShowSignIn(false);
      }
    } finally {
      setProgress(null);
    }
  };

  const stopText = (r: SyncReport): string | null => {
    const e = r.stoppedBy;
    if (!e) return null;
    if (e instanceof Error && e.message === 'NO_SIGN_IN') return t('sync.signInMissing');
    if (isNetworkError(e)) return noAnswer(address);
    if (isApiError(e)) {
      if (r.stoppedAt === 'signIn' && e.status === 401) return t('sync.signInRefused', { name: getServerCredentials()?.loginName ?? '', message: e.message });
      if (e.status === 426) return t('sync.updateNeeded', { message: e.message });
      if (e.status === 403) return t('sync.noRight', { message: e.message });
      return t('sync.server', { message: errorText(e) });
    }
    return t('common.error');
  };

  /** Why the ledgers did not come, in words; null when they came (or the run stopped before). */
  const ledgerText = (e: unknown): string | null => {
    if (!e) return null;
    if (isLedgerStepError(e)) return e.code === 'NO_COMPANY' ? t('sync.ledgerNoCompany') : t('sync.ledgerNoYear');
    if (isApiError(e) && e.status === 403) return t('sync.ledgerNoRight');
    if (isNetworkError(e)) return noAnswer(address);
    return t('sync.ledgerFailed', { message: errorText(e) });
  };

  const sent = report?.outcomes.filter((o) => o.status !== 'refused').length ?? 0;
  const refused = report?.outcomes.filter((o) => o.status === 'refused').length ?? 0;
  const stop = report ? stopText(report) : null;
  const got = report?.downloaded;
  const updates = report?.updates ?? [];
  const updatesSent = updates.filter((u) => u.status === 'updated').length;
  const ledgerStop = report ? ledgerText(report.ledgerStoppedBy) : null;
  const ledger = report?.ledger;
  const orders = report?.orders ?? [];
  const ordersSent = orders.filter((o) => o.status === 'uploaded' || o.status === 'alreadySaved').length;
  const visits = report?.visits ?? [];
  const visitsSent = visits.filter((v) => v.status === 'uploaded' || v.status === 'alreadySaved').length;
  const rcts = report?.receipts ?? [];
  const rctsSent = rcts.filter((r) => r.status === 'uploaded' || r.status === 'alreadySaved').length;
  const receiptData = report?.receiptData;
  const receiptDataStop = report?.receiptDataStoppedBy
    ? isNetworkError(report.receiptDataStoppedBy)
      ? noAnswer(address)
      : isRouteMissing(report.receiptDataStoppedBy)
        ? t('sync.receiptDataNotOnServer')
        : t('sync.receiptDataFailed', { message: errorText(report.receiptDataStoppedBy) })
    : null;
  const items = report?.items;
  const itemsStop = report?.itemsStoppedBy
    ? isNetworkError(report.itemsStoppedBy)
      ? noAnswer(address)
      : t('sync.itemsFailed', { message: errorText(report.itemsStoppedBy) })
    : null;
  const branchesGot = report?.branches;
  const branchesStop = report?.branchesStoppedBy
    ? isNetworkError(report.branchesStoppedBy)
      ? noAnswer(address)
      : t('sync.branchesFailed', { message: errorText(report.branchesStoppedBy) })
    : null;
  const deviceStop = report?.sendRefusedBy ? t('sync.deviceRefused', { message: errorText(report.sendRefusedBy) }) : null;
  const receiptsStop = report?.receiptsRouteMissing
    ? t('sync.receiptsNotOnServer')
    : report?.receiptsRefusedBy
      ? t('sync.receiptsRefused', { message: errorText(report.receiptsRefusedBy) })
      : null;
  const hasResult =
    !!report &&
    (report.outcomes.length > 0 ||
      updates.length > 0 ||
      orders.length > 0 ||
      visits.length > 0 ||
      rcts.length > 0 ||
      !!got ||
      !!stop ||
      !!ledger ||
      !!ledgerStop ||
      !!items ||
      !!itemsStop ||
      !!branchesGot ||
      !!branchesStop ||
      !!receiptData ||
      !!receiptDataStop ||
      !!deviceStop ||
      !!receiptsStop);

  return (
    <View style={st.root}>
      <View style={[st.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('sync.back')} onPress={() => router.back()} style={st.back}>
          <Ionicons name="chevron-back" size={24} color={colors.onPrimary} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={st.title} accessibilityRole="header">
            {t('sync.title')}
          </Text>
          <Text style={st.subtitle}>{t('sync.subtitle')}</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView contentContainerStyle={st.body} keyboardShouldPersistTaps="handled">
          <Card title={t('sync.serverTitle')}>
            <TextField
              label={t('sync.address')}
              value={address}
              onChangeText={(v) => {
                setAddress(v);
                setCheck(null);
              }}
              placeholder={t('sync.addressPlaceholder')}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
              error={addressError}
            />
            <Button title={t('sync.test')} variant="outline" loading={testing} onPress={() => void test()} />
            {check ? <StatusLine ok={check.ok} text={check.text} /> : null}
          </Card>

          <Card title={t('sync.signInTitle')}>
            {showSignIn ? (
              <>
                <Text style={st.note}>{t('sync.signInNote')}</Text>
                <TextField label={t('sync.loginName')} value={loginName} onChangeText={setLoginName} autoCapitalize="none" autoCorrect={false} />
                <PasswordField label={t('sync.password')} value={password} onChangeText={setPassword} textContentType="password" />
              </>
            ) : (
              <View style={st.row}>
                <Text style={[st.note, { flex: 1 }]}>{t('sync.signsInAs', { name: getServerCredentials()?.loginName ?? '' })}</Text>
                <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setShowSignIn(true)}>
                  <Text style={st.link}>{t('sync.change')}</Text>
                </Pressable>
              </View>
            )}
          </Card>

          <Card title={t('sync.deviceTitle')}>
            <Text style={st.deviceUid} selectable accessibilityLabel={deviceUid.split('').join(' ')}>
              {deviceUid}
            </Text>
            {report?.deviceRegistered === true ? (
              <StatusLine ok text={t('sync.deviceRegistered')} />
            ) : report?.deviceRegistered === false ? (
              <StatusLine ok={false} text={t('sync.deviceNotRegistered', { uid: deviceUid })} />
            ) : (
              <Text style={[st.note, { marginTop: spacing.sm, marginBottom: 0 }]}>{t('sync.deviceNote')}</Text>
            )}
          </Card>

          <Card title={t('sync.waitingTitle', { n: waitingCount })}>
            {waitingCount === 0 ? <Text style={st.note}>{t('sync.nothingWaiting')}</Text> : null}
            {pending.map((c) => (
              <View key={c.cusId} style={st.item}>
                <Ionicons name={c.appSyncError ? 'alert-circle' : 'time-outline'} size={20} color={c.appSyncError ? colors.danger : colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={st.itemName}>
                    {c.cusName} <Text style={st.itemTag}>· {c.isNew ? t('sync.tagNew') : t('sync.tagEdit')}</Text>
                  </Text>
                  {c.appSyncError ? <Text style={st.itemError}>{c.appSyncError}</Text> : null}
                </View>
              </View>
            ))}
            {waitingOrders.map((o) => (
              <WaitingRow key={`o-${o.id}`} name={o.customerName} tag={t('sync.tagOrder')} error={o.appSyncError} />
            ))}
            {waitingVisits.map((v) => (
              <WaitingRow key={`v-${v.id}`} name={v.customerName ?? ''} tag={t('sync.tagVisit')} error={v.appSyncError} />
            ))}
            {waitingReceipts.map((r) => (
              <WaitingRow
                key={`r-${r.id}`}
                name={r.customerName}
                tag={t('sync.tagReceipt', { no: r.refNo, amount: formatAmount(toPaise(r.amount) ?? 0) })}
                error={r.appSyncError}
              />
            ))}
          </Card>

          {bills.length > 0 ? (
            <Card title={t('sync.billsTitle', { n: bills.length })}>
              <Text style={st.note}>{t('sync.billsNote')}</Text>
              {bills.map((b) => (
                <WaitingRow key={`b-${b.id}`} name={b.customerName} tag={`${b.refNo} · ${formatAmount(toPaise(b.amount) ?? 0)}`} error={null} />
              ))}
            </Card>
          ) : null}

          {returns.length > 0 ? (
            <Card title={t('sync.returnsTitle', { n: returns.length })}>
              <Text style={st.note}>{t('sync.returnsNote')}</Text>
              {returns.map((r) => (
                <WaitingRow key={`sr-${r.id}`} name={r.customerName} tag={`${r.refNo} · ${formatAmount(toPaise(r.amount) ?? 0)}`} error={null} />
              ))}
            </Card>
          ) : null}

          {report && hasResult ? (
            <Card title={t('sync.resultTitle')}>
              {report.outcomes.length > 0 ? <Text style={st.note}>{t('sync.summary', { sent, refused })}</Text> : null}
              {report.outcomes.map((o) => (
                <View key={o.localId} style={st.item}>
                  <Ionicons
                    name={o.status === 'refused' ? 'close-circle' : 'checkmark-circle'}
                    size={20}
                    color={o.status === 'refused' ? colors.danger : colors.success}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={st.itemName}>{o.name}</Text>
                    <Text style={o.status === 'refused' ? st.itemError : st.itemOk}>
                      {o.status === 'uploaded'
                        ? t('sync.uploaded', { code: o.serverCode ?? '' })
                        : o.status === 'linked'
                          ? t('sync.linked', { code: o.serverCode ?? '' })
                          : o.error}
                    </Text>
                  </View>
                </View>
              ))}
              {updates.length > 0 ? (
                <Text style={[st.note, report.outcomes.length > 0 && { marginTop: spacing.md }]}>
                  {t('sync.updatesSummary', { sent: updatesSent, refused: updates.length - updatesSent })}
                </Text>
              ) : null}
              {updates.map((u) => (
                <View key={`u-${u.cusId}`} style={st.item}>
                  <Ionicons
                    name={u.status === 'refused' ? 'close-circle' : 'checkmark-circle'}
                    size={20}
                    color={u.status === 'refused' ? colors.danger : colors.success}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={st.itemName}>{u.name}</Text>
                    <Text style={u.status === 'refused' ? st.itemError : st.itemOk}>{u.status === 'refused' ? u.error : t('sync.updated')}</Text>
                  </View>
                </View>
              ))}
              {orders.length > 0 ? (
                <Text style={[st.note, (report.outcomes.length > 0 || updates.length > 0) && { marginTop: spacing.md }]}>
                  {t('sync.ordersSummary', { sent: ordersSent, refused: orders.length - ordersSent })}
                </Text>
              ) : null}
              {orders.map((o) => {
                const ok = o.status === 'uploaded' || o.status === 'alreadySaved';
                return (
                  <ResultRow
                    key={`o-${o.localId}`}
                    ok={ok}
                    name={`${t('sync.tagOrder')} · ${o.customerName}`}
                    text={
                      ok
                        ? t(o.status === 'uploaded' ? 'sync.orderUploaded' : 'sync.orderAlreadySaved', { refno: o.orderRefno ?? '', status: o.orderStatus ?? '' })
                        : (o.error ?? '')
                    }
                    note={o.deletedOnServer ? t('sync.orderDeletedOnServer') : undefined}
                  />
                );
              })}
              {visits.length > 0 ? (
                <Text style={[st.note, (report.outcomes.length > 0 || updates.length > 0 || orders.length > 0) && { marginTop: spacing.md }]}>
                  {t('sync.visitsSummary', { sent: visitsSent, refused: visits.length - visitsSent })}
                </Text>
              ) : null}
              {visits.map((v) => {
                const ok = v.status === 'uploaded' || v.status === 'alreadySaved';
                return (
                  <ResultRow
                    key={`v-${v.localId}`}
                    ok={ok}
                    name={`${t('sync.tagVisit')} · ${v.customerName}`}
                    text={ok ? t(v.status === 'uploaded' ? 'sync.visitUploaded' : 'sync.visitAlreadySaved') : (v.error ?? '')}
                  />
                );
              })}
              {rcts.length > 0 ? (
                <Text style={[st.note, { marginTop: spacing.md }]}>{t('sync.receiptsSummary', { sent: rctsSent, refused: rcts.length - rctsSent })}</Text>
              ) : null}
              {rcts.map((r) => {
                const ok = r.status === 'uploaded' || r.status === 'alreadySaved';
                return (
                  <ResultRow
                    key={`r-${r.localId}`}
                    ok={ok}
                    name={`${t('sync.tagReceiptNo', { no: r.phoneRefno })} · ${r.customerName}`}
                    text={
                      ok
                        ? t(r.status === 'uploaded' ? 'sync.receiptUploaded' : 'sync.receiptAlreadySaved', { refno: r.voucherRefno ?? '', status: r.voucherStatus ?? '' })
                        : (r.error ?? '')
                    }
                    note={ok && Number(r.onAccount) > 0 ? t('sync.receiptOnAccount', { amount: formatAmount(toPaise(r.onAccount) ?? 0) }) : undefined}
                  />
                );
              })}
              {deviceStop ? <StatusLine ok={false} text={deviceStop} /> : null}
              {receiptsStop ? <StatusLine ok={false} text={receiptsStop} /> : null}
              {got ? (
                <View style={[st.item, report.outcomes.length === 0 && updates.length === 0 && orders.length === 0 && visits.length === 0 && st.itemFirst]}>
                  <Ionicons name="cloud-download-outline" size={20} color={colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.itemOk}>{t('sync.received', { n: got.saved })}</Text>
                    {got.removed > 0 ? <Text style={st.itemNote}>{t('sync.removed', { n: got.removed })}</Text> : null}
                    {got.skipped > 0 ? <Text style={st.itemError}>{t('sync.skipped', { n: got.skipped })}</Text> : null}
                  </View>
                </View>
              ) : null}
              {items ? (
                <View style={st.item}>
                  <Ionicons name="cube-outline" size={20} color={colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.itemOk}>{t('sync.itemsReceived', { items: items.items, companies: items.companies })}</Text>
                  </View>
                </View>
              ) : null}
              {itemsStop ? <StatusLine ok={false} text={itemsStop} /> : null}
              {branchesGot ? (
                <View style={st.item}>
                  <Ionicons name="git-branch-outline" size={20} color={colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.itemOk}>{t('sync.branchesReceived', { branches: branchesGot.branches, companies: branchesGot.companies })}</Text>
                  </View>
                </View>
              ) : null}
              {branchesStop ? <StatusLine ok={false} text={branchesStop} /> : null}
              {receiptData ? (
                <View style={st.item}>
                  <Ionicons name="receipt-outline" size={20} color={colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.itemOk}>{t('sync.receiptDataDone', { bills: receiptData.bills, companies: receiptData.companies })}</Text>
                  </View>
                </View>
              ) : null}
              {receiptDataStop ? <StatusLine ok={false} text={receiptDataStop} /> : null}
              {ledger ? (
                <View style={st.item}>
                  <Ionicons name="document-text-outline" size={20} color={colors.success} />
                  <View style={{ flex: 1 }}>
                    <Text style={st.itemOk}>{t('sync.ledgerReceived', { n: ledger.read })}</Text>
                    {ledger.skipped > 0 ? <Text style={st.itemNote}>{t('sync.ledgerSkipped', { n: ledger.skipped })}</Text> : null}
                  </View>
                </View>
              ) : null}
              {ledgerStop ? <StatusLine ok={false} text={ledgerStop} /> : null}
              {stop ? <StatusLine ok={false} text={stop} /> : null}
            </Card>
          ) : null}
        </ScrollView>

        <View style={[st.footer, { paddingBottom: insets.bottom + spacing.lg }]}>
          {progress ? (
            <Text style={st.progress} accessibilityLiveRegion="polite">
              {progress}
            </Text>
          ) : null}
          <Button title={t('sync.syncNow')} loading={!!progress} onPress={() => void sync()} style={{ height: 52 }} />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

/** "CUSTOMER_UNKNOWN_GROUP: …" style text of a VK Nex refusal. */
function errorText(e: unknown): string {
  if (isApiError(e)) return e.code ? `${e.code}: ${e.message}` : e.message;
  return e instanceof Error ? e.message : String(e);
}

/** One record still on the phone: a waiting order or check-in, with the last refusal. */
function WaitingRow({ name, tag, error }: { name: string; tag: string; error: string | null }) {
  return (
    <View style={st.item}>
      <Ionicons name={error ? 'alert-circle' : 'time-outline'} size={20} color={error ? colors.danger : colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={st.itemName}>
          {name} <Text style={st.itemTag}>· {tag}</Text>
        </Text>
        {error ? <Text style={st.itemError}>{error}</Text> : null}
      </View>
    </View>
  );
}

/** One record of the last Sync: sent (with VK Nex's answer) or not (with why). */
function ResultRow({ ok, name, text, note }: { ok: boolean; name: string; text: string; note?: string }) {
  return (
    <View style={st.item}>
      <Ionicons name={ok ? 'checkmark-circle' : 'close-circle'} size={20} color={ok ? colors.success : colors.danger} />
      <View style={{ flex: 1 }}>
        <Text style={st.itemName}>{name}</Text>
        <Text style={ok ? st.itemOk : st.itemError}>{text}</Text>
        {note ? <Text style={st.itemNote}>{note}</Text> : null}
      </View>
    </View>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={st.card}>
      <Text style={st.cardTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

function StatusLine({ ok, text }: { ok: boolean; text: string }) {
  return (
    <View style={[st.row, { marginTop: spacing.md }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name={ok ? 'checkmark-circle' : 'alert-circle'} size={20} color={ok ? colors.success : colors.danger} />
      <Text style={[st.status, { color: ok ? colors.success : colors.danger }]}>{text}</Text>
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
  body: { padding: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  cardTitle: { fontSize: font.sm, fontWeight: '700', letterSpacing: 0.5, color: colors.primary, textTransform: 'uppercase', marginBottom: spacing.md },
  note: { fontSize: font.sm, color: colors.textMuted, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  link: { fontSize: font.sm, fontWeight: '700', color: colors.primary },
  status: { flex: 1, fontSize: font.sm },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  itemName: { fontSize: font.md, fontWeight: '600', color: colors.text },
  itemTag: { fontSize: font.sm, fontWeight: '400', color: colors.textMuted },
  itemError: { marginTop: 2, fontSize: font.sm, color: colors.danger },
  itemOk: { marginTop: 2, fontSize: font.sm, color: colors.success },
  itemNote: { marginTop: 2, fontSize: font.sm, color: colors.textMuted },
  itemFirst: { borderTopWidth: 0, paddingTop: 0 },
  deviceUid: { fontSize: font.xl, fontWeight: '700', letterSpacing: 1, color: colors.text, fontVariant: ['tabular-nums'] },
  footer: { paddingTop: spacing.md, paddingHorizontal: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  progress: { marginBottom: spacing.sm, fontSize: font.sm, color: colors.textMuted, textAlign: 'center' },
});

import { StyleSheet } from 'react-native';

import { colors, font, radius, spacing } from '@/theme';

/** Styles the sales return screens share (canvas 6b). */
export const returnStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { padding: spacing.lg, gap: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.md + 2 },
  small: { fontSize: 12.5, color: colors.textMuted },
  hint: { fontSize: 12, color: colors.textMuted },
  between: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  chip: { fontSize: 12, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 1, borderRadius: 6, overflow: 'hidden' },
  chipOk: { backgroundColor: '#F0FDF4', color: '#166534' },
  chipWarn: { backgroundColor: '#FEF3C7', color: '#92400E' },
  chipGrey: { backgroundColor: colors.border, color: colors.textLabel },
  warn: { flexDirection: 'row', gap: 10, backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#FCD34D', borderRadius: radius.md + 2, padding: spacing.md },
  warnText: { flex: 1, fontSize: font.sm, lineHeight: 19, color: '#78350F' },
});

/** Chip colours per condition: Good green, Damaged red, Expired amber, Scrap grey. */
export const CONDITION_TONES = {
  RESTOCK: { bg: '#DCFCE7', fg: '#166534' },
  DAMAGED: { bg: '#FEE2E2', fg: '#991B1B' },
  EXPIRED: { bg: '#FEF3C7', fg: '#92400E' },
  SCRAP: { bg: '#E7E5E4', fg: '#44403C' },
} as const;

/** Status chips (Return list, Return detail). */
export const STATUS_TONES: Record<string, { bg: string; fg: string; border?: string }> = {
  WAITING: { bg: '#FEF3C7', fg: '#92400E' },
  HELD: { bg: '#EDE9FE', fg: '#5B21B6', border: '#C4B5FD' },
  SENT_BACK: { bg: '#FEE2E2', fg: '#991B1B', border: '#FCA5A5' },
  POSTED: { bg: '#DCFCE7', fg: '#166534' },
  CANCELLED: { bg: '#E7E5E4', fg: '#44403C' },
  OLD: { bg: '#E7E5E4', fg: '#44403C' },
};

/** The bottom bar (total + main button) on the return screens. */
export const barStyles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  barSmall: { fontSize: 12, color: colors.textMuted },
  barTotal: { fontSize: 19, fontWeight: '700', color: colors.text },
  barBtn: { minHeight: 52, minWidth: 150, borderRadius: radius.md + 2, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  barBtnText: { fontSize: font.md, fontWeight: '600', color: colors.onPrimary },
});

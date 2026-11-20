/** VK Softwares brand: maroon + brass. Keep every colour/spacing value here. */
export const colors = {
  primary: '#8B1D1D',
  accent: '#C9A227',
  /** Light maroon tint behind active filters. */
  primarySoft: '#F8E8E8',
  /** Text and icons on the maroon band / buttons. */
  onPrimary: '#FFFFFF',
  onPrimaryMuted: '#F3DADA',
  bg: '#F5F3F0',
  surface: '#FFFFFF',
  text: '#1C1917',
  /** Field labels. */
  textLabel: '#44403C',
  textMuted: '#57534E',
  /** Card and list outlines. */
  border: '#E7E5E4',
  /** Input outlines (a step darker than cards so fields read as tappable). */
  inputBorder: '#D6D3D1',
  danger: '#B91C1C',
  /** Done / sent (green-700: 5:1 on white). */
  success: '#15803D',
} as const;

/** Visit-status chips on the customer list (background / text). */
export const statusColors = {
  notVisited: { bg: '#E7E5E4', fg: '#44403C' },
  noOrder: { bg: '#FEF3C7', fg: '#92400E' },
  billed: { bg: '#DCFCE7', fg: '#166534' },
  ordered: { bg: '#DBEAFE', fg: '#1E40AF' },
  received: { bg: '#EDE9FE', fg: '#5B21B6' },
} as const;

/**
 * Offers (mockup 2026-11-19): green = applied now, amber = not reached yet / short, maroon tints =
 * an offer still to reach (outlined badge, dashed order-offer banner, the Order item card).
 */
export const offerColors = {
  okBg: '#ECFDF5',
  okBorder: '#A7F3D0',
  okText: '#047857',
  freeBg: '#F0FDF4',
  freeBorder: '#BBF7D0',
  warn: '#92400E',
  badgeBorder: '#EBC3C3',
  bannerBorder: '#DFA3A3',
  cardBorder: '#E2B1B1',
  slabBg: '#FAFAF9',
  mrpBg: '#F5F5F4',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 14 } as const;
export const font = { sm: 13, md: 15, lg: 17, xl: 22, xxl: 28 } as const;

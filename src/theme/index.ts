/** VK Softwares brand: maroon + brass. Keep every colour/spacing value here. */
export const colors = {
  primary: '#8B1D1D',
  primaryDark: '#6B1515',
  accent: '#C9A227',
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
  success: '#15803D',
  warning: '#B45309',
  danger: '#B91C1C',
  info: '#1D4ED8',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 14 } as const;
export const font = { sm: 13, md: 15, lg: 17, xl: 22, xxl: 28 } as const;

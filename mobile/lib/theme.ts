// Lozi brand theme — mirrors the frozen web app's light palette
// (src/styles/app.css :root) so both clients read as one product.
// Fonts are the Tajawal family, loaded in app/_layout.tsx via useFonts;
// use these constants as fontFamily values, never raw strings.

export const colors = {
  cream: '#FAF7F2',
  surface: '#FFFFFF',
  sand: '#F4ECDC',
  ink: '#2C271C',
  inkSoft: '#6E6557',
  muted: '#A39A88',
  line: '#EEE5D4',
  green: '#3C7A50',
  greenDeep: '#2F5E3E',
  greenSoft: '#E8F1EA',
  gold: '#E6C088',
  goldDeep: '#C08A43',
  danger: '#C2553F',
} as const;

export const fonts = {
  regular: 'Tajawal_400Regular',
  medium: 'Tajawal_500Medium',
  bold: 'Tajawal_700Bold',
  extraBold: 'Tajawal_800ExtraBold',
} as const;

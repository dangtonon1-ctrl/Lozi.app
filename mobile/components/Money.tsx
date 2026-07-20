import { Text, type StyleProp, type TextStyle } from 'react-native';

import { CURRENCY_YER, fmtMoney } from '../lib/catalog';
import { colors, fonts } from '../lib/theme';

// Price = integer with en-US thousands separators + the YER unit in small type,
// mirroring the web Money component (app.ui.js).
export function Money({
  value,
  size = 16,
  color = colors.ink,
  style,
}: {
  value: number | null | undefined;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text style={[{ fontFamily: fonts.bold, fontSize: size, color }, style]}>
      {fmtMoney(value)}{' '}
      <Text style={{ fontFamily: fonts.medium, fontSize: size * 0.62 }}>{CURRENCY_YER}</Text>
    </Text>
  );
}

import { StyleSheet, Text, View } from 'react-native';

import { copy } from '../lib/copy';
import { colors, fonts } from '../lib/theme';

// Placeholder for tabs/screens not yet built — an honest قريباً instead of a
// blank or broken screen.
export function ComingSoon({ title }: { title: string }) {
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.soon}>{copy.comingSoon}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.cream, padding: 24 },
  title: { fontSize: 22, fontFamily: fonts.bold, color: colors.ink },
  soon: { fontSize: 16, fontFamily: fonts.medium, color: colors.goldDeep },
});

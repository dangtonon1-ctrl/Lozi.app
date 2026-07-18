import { Redirect } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../lib/auth';
import { colors, fonts } from '../lib/theme';

// Entry gate: while the session is being restored show a branded splash, then
// route to the authed app or the login screen. The route-group layouts
// ((auth)/_layout, (app)/_layout) enforce the same guard so deep links land right.
export default function Index() {
  const { status } = useAuth();

  if (status === 'checking') {
    return (
      <View style={styles.screen}>
        <Text style={styles.brand}>لوزي</Text>
        <ActivityIndicator color={colors.greenDeep} />
      </View>
    );
  }

  return <Redirect href={status === 'authed' ? '/home' : '/login'} />;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    backgroundColor: colors.cream,
  },
  brand: { fontSize: 44, fontFamily: fonts.extraBold, color: colors.greenDeep },
});

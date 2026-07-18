import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';

// Auth screens are only for signed-out users; bounce authed users to the app.
export default function AuthLayout() {
  const { status } = useAuth();

  if (status === 'checking') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.greenDeep} />
      </View>
    );
  }
  if (status === 'authed') return <Redirect href="/home" />;

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.cream } }}
    />
  );
}

const styles = {
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
} as const;

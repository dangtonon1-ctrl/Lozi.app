import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '../../lib/auth';
import { colors } from '../../lib/theme';

// App screens require a session; bounce signed-out users to login.
export default function AppLayout() {
  const { status } = useAuth();

  if (status === 'checking') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.greenDeep} />
      </View>
    );
  }
  if (status === 'signedOut') return <Redirect href="/login" />;

  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.cream } }}
    />
  );
}

const styles = {
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cream },
} as const;

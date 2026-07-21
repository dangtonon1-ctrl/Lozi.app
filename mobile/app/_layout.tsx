import {
  Tajawal_400Regular,
  Tajawal_500Medium,
  Tajawal_700Bold,
  Tajawal_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/tajawal';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { ToastProvider } from '../components/Toast';
import { AuthProvider } from '../lib/auth';
import { colors } from '../lib/theme';

// Single stack, header hidden. Theme (Step 3): Tajawal is bundled in the app
// binary, so this resolves in a frame or two — holding render until then
// avoids a flash of the platform fallback font. RTL is forced natively via
// extra.supportsRTL/forcesRTL + the expo-localization plugin (app.json).
export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Tajawal_400Regular,
    Tajawal_500Medium,
    Tajawal_700Bold,
    Tajawal_800ExtraBold,
    // Icon font ships as a JS-bundled asset via OTA (expo-font is already native);
    // load it up front so tab icons don't flash in.
    ...Ionicons.font,
  });

  if (!fontsLoaded) return null;

  return (
    <AuthProvider>
      <ToastProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.cream },
          }}
        />
      </ToastProvider>
    </AuthProvider>
  );
}

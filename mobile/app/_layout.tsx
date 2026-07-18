import { Stack } from 'expo-router';

// Single stack, header hidden. No theming yet — that lands in Step 3.
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

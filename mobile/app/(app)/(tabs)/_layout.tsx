import { Tabs } from 'expo-router';
import { Text } from 'react-native';

import { useAuth } from '../../../lib/auth';
import { copy } from '../../../lib/copy';
import { colors, fonts } from '../../../lib/theme';

// Bottom tab shell. Five tabs; the 3rd swaps by role — customer → التوفير (savings),
// seller → الطلبات (dashboard) — via href:null to hide the inactive one. Icons are
// emoji placeholders for now (tinted vector/rasterized icons are a logged parity
// gap — @expo/vector-icons isn't installed and react-native-svg is deferred).
export default function TabsLayout() {
  const { role } = useAuth();
  const isSeller = !!role && role !== 'customer';

  return (
    <Tabs
      initialRouteName="home"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.greenDeep,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
      }}
    >
      <Tabs.Screen name="home" options={{ title: copy.navHome, tabBarIcon: () => <Ico e="🏠" /> }} />
      <Tabs.Screen name="sections" options={{ title: copy.navSections, tabBarIcon: () => <Ico e="🗂️" /> }} />
      <Tabs.Screen
        name="savings"
        options={{ href: isSeller ? null : '/savings', title: copy.navSavings, tabBarIcon: () => <Ico e="💰" /> }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{ href: isSeller ? '/dashboard' : null, title: copy.navDashboard, tabBarIcon: () => <Ico e="🚚" /> }}
      />
      <Tabs.Screen name="cart" options={{ title: copy.navCart, tabBarIcon: () => <Ico e="🛒" /> }} />
      <Tabs.Screen name="profile" options={{ title: copy.navProfile, tabBarIcon: () => <Ico e="👤" /> }} />
    </Tabs>
  );
}

function Ico({ e }: { e: string }) {
  return <Text style={{ fontSize: 20 }}>{e}</Text>;
}

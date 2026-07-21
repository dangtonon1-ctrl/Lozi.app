import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { type ComponentProps } from 'react';
import { type ColorValue } from 'react-native';

import { useAuth } from '../../../lib/auth';
import { copy } from '../../../lib/copy';
import { colors, fonts } from '../../../lib/theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

// Ionicons line icons (single-color, tinted by active state) — OTA-safe (JS + font
// asset over expo-font, no native module, fingerprint unchanged). Outline when
// inactive, filled when focused.
function tabIcon(outline: IoniconName, filled: IoniconName) {
  return ({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) => (
    <Ionicons name={focused ? filled : outline} size={size ?? 22} color={color} />
  );
}

// Bottom tab shell. Five tabs; the 3rd swaps by role — customer → التوفير (savings),
// seller → الطلبات (dashboard) — via href:null to hide the inactive one.
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
      <Tabs.Screen name="home" options={{ title: copy.navHome, tabBarIcon: tabIcon('home-outline', 'home') }} />
      <Tabs.Screen name="sections" options={{ title: copy.navSections, tabBarIcon: tabIcon('grid-outline', 'grid') }} />
      <Tabs.Screen
        name="savings"
        options={{ href: isSeller ? null : '/savings', title: copy.navSavings, tabBarIcon: tabIcon('pricetags-outline', 'pricetags') }}
      />
      <Tabs.Screen
        name="dashboard"
        options={{ href: isSeller ? '/dashboard' : null, title: copy.navDashboard, tabBarIcon: tabIcon('receipt-outline', 'receipt') }}
      />
      <Tabs.Screen name="cart" options={{ title: copy.navCart, tabBarIcon: tabIcon('cart-outline', 'cart') }} />
      <Tabs.Screen name="profile" options={{ title: copy.navProfile, tabBarIcon: tabIcon('person-outline', 'person') }} />
    </Tabs>
  );
}

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth, type Role } from '../../../lib/auth';
import { copy } from '../../../lib/copy';
import { colors, fonts } from '../../../lib/theme';

const ROLE_LABEL: Record<Role, string> = {
  customer: copy.roleCustomer,
  farmer: copy.roleFarmer,
  farmer_almond: copy.roleFarmer,
  retail: copy.roleRetail,
  wholesale: copy.roleWholesale,
};

// Profile tab — قريباً for now, but it hosts sign-out so the action has a stable
// home once the catalog home stops carrying it (home rebuild).
export default function ProfileTab() {
  const { role, person, logout } = useAuth();
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>{copy.navProfile}</Text>
      {!!person.name && <Text style={styles.name}>{person.name}</Text>}
      <View style={styles.badge}>
        <Text style={styles.badgeText}>{role ? (ROLE_LABEL[role] ?? role) : '—'}</Text>
      </View>
      <Text style={styles.soon}>{copy.comingSoon}</Text>
      <Pressable style={styles.logout} onPress={logout} accessibilityRole="button">
        <Text style={styles.logoutText}>{copy.signOut}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.cream, padding: 24 },
  title: { fontSize: 22, fontFamily: fonts.bold, color: colors.ink },
  name: { fontSize: 16, fontFamily: fonts.medium, color: colors.inkSoft },
  badge: { backgroundColor: colors.greenSoft, paddingVertical: 6, paddingHorizontal: 16, borderRadius: 999 },
  badgeText: { fontSize: 15, fontFamily: fonts.bold, color: colors.greenDeep },
  soon: { fontSize: 15, fontFamily: fonts.medium, color: colors.goldDeep, marginTop: 4 },
  logout: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  logoutText: { fontSize: 16, fontFamily: fonts.bold, color: colors.danger },
});

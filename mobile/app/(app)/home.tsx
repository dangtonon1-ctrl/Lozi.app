import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth, type Role } from '../../lib/auth';
import { copy } from '../../lib/copy';
import { supabase } from '../../lib/supabase';
import { colors, fonts } from '../../lib/theme';

const ROLE_LABEL: Record<Role, string> = {
  customer: copy.roleCustomer,
  farmer: copy.roleFarmer,
  farmer_almond: copy.roleFarmer,
  retail: copy.roleRetail,
  wholesale: copy.roleWholesale,
};

type ConnState = { kind: 'checking' } | { kind: 'ok' } | { kind: 'fail'; reason: string };

// Placeholder authed screen for Task 1: proves session restore, the
// server-derived role badge, connectivity, and sign-out. Real app shell lands
// in later Phase 1 tasks.
export default function Home() {
  const { role, person, logout } = useAuth();
  const [conn, setConn] = useState<ConnState>({ kind: 'checking' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { error } = await supabase.from('products').select('id').limit(1);
      if (cancelled) return;
      setConn(error ? { kind: 'fail', reason: error.message } : { kind: 'ok' });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.screen}>
      <Text style={styles.brand}>لوزي</Text>

      <Text style={styles.greeting}>
        {copy.welcome}
        {person.name ? ` · ${person.name}` : ''}
      </Text>

      <View style={styles.badge}>
        <Text style={styles.badgeText}>{role ? (ROLE_LABEL[role] ?? role) : '—'}</Text>
      </View>

      {conn.kind === 'checking' && <ActivityIndicator color={colors.greenDeep} />}
      {conn.kind === 'ok' && <Text style={[styles.status, styles.ok]}>نجح الاتصال</Text>}
      {conn.kind === 'fail' && (
        <>
          <Text style={[styles.status, styles.fail]}>فشل الاتصال</Text>
          <Text style={styles.reason}>{conn.reason}</Text>
        </>
      )}

      <Pressable style={styles.logout} onPress={logout} accessibilityRole="button">
        <Text style={styles.logoutText}>{copy.signOut}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
    backgroundColor: colors.cream,
  },
  brand: { fontSize: 40, fontFamily: fonts.extraBold, color: colors.greenDeep },
  greeting: { fontSize: 18, fontFamily: fonts.medium, color: colors.ink, textAlign: 'center' },
  badge: {
    backgroundColor: colors.greenSoft,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  badgeText: { fontSize: 15, fontFamily: fonts.bold, color: colors.greenDeep },
  status: { fontSize: 20, fontFamily: fonts.bold },
  ok: { color: colors.greenDeep },
  fail: { color: colors.danger },
  reason: { fontSize: 12, fontFamily: fonts.regular, color: colors.muted, textAlign: 'center' },
  logout: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  logoutText: { fontSize: 16, fontFamily: fonts.bold, color: colors.danger },
});

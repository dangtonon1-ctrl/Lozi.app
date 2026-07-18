import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { supabase } from '../lib/supabase';
import { colors, fonts } from '../lib/theme';

type ConnState =
  | { kind: 'checking' }
  | { kind: 'ok' }
  | { kind: 'fail'; reason: string };

// Step 1 acceptance test: on startup, do one trivial read against a public,
// anon-readable table (public.products) and report success/failure in Arabic.
export default function Index() {
  const [state, setState] = useState<ConnState>({ kind: 'checking' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { error } = await supabase.from('products').select('id').limit(1);
      if (cancelled) return;
      setState(error ? { kind: 'fail', reason: error.message } : { kind: 'ok' });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.screen}>
      <Text style={styles.brand}>لوزي</Text>

      {state.kind === 'checking' && (
        <View style={styles.checking}>
          <ActivityIndicator color={colors.greenDeep} />
          <Text style={styles.status}>جارٍ التحقق من الاتصال…</Text>
        </View>
      )}

      {state.kind === 'ok' && (
        <Text style={[styles.status, styles.ok]}>نجح الاتصال</Text>
      )}

      {state.kind === 'fail' && (
        <>
          <Text style={[styles.status, styles.fail]}>فشل الاتصال</Text>
          <Text style={styles.reason}>{state.reason}</Text>
        </>
      )}

      {/* OTA canary (Phase 0 Step 4): this line ships via EAS Update, not an
          APK — seeing it on device proves the OTA pipeline end to end. */}
      <Text style={styles.otaTag}>OTA-1 ✓ التحديث وصل</Text>
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
  checking: { alignItems: 'center', gap: 8 },
  brand: { fontSize: 40, fontFamily: fonts.extraBold, color: colors.greenDeep },
  status: { fontSize: 20, fontFamily: fonts.medium, color: colors.inkSoft },
  ok: { color: colors.greenDeep, fontFamily: fonts.bold },
  fail: { color: colors.danger, fontFamily: fonts.bold },
  reason: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.muted,
    textAlign: 'center',
  },
  otaTag: { fontSize: 14, fontFamily: fonts.medium, color: colors.goldDeep },
});

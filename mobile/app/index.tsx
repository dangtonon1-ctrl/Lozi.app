import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { supabase } from '../lib/supabase';

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
          <ActivityIndicator />
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
    </View>
  );
}

// Layout only (centering) — no theme/colors work yet beyond a pass/fail cue.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  checking: { alignItems: 'center', gap: 8 },
  brand: { fontSize: 40 },
  status: { fontSize: 20 },
  ok: { color: 'green' },
  fail: { color: 'red' },
  reason: { fontSize: 12, opacity: 0.6, textAlign: 'center' },
});

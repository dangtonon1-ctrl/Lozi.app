import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ErrKind } from '../lib/catalog';
import { copy } from '../lib/copy';
import { colors, fonts } from '../lib/theme';

export function EmptyState({ label = copy.catalogEmpty }: { label?: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.emptyIcon}>🥜</Text>
      <Text style={styles.emptyText}>{label}</Text>
    </View>
  );
}

// Distinguishes no-connection from server error (the web showed neither), each
// with a retry. `kind` comes from the catalog data layer's error classification.
export function ErrorRetry({ kind, onRetry }: { kind: ErrKind; onRetry: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.errText}>{kind === 'network' ? copy.errNetwork : copy.errServerLoad}</Text>
      <Pressable style={styles.retryBtn} onPress={onRetry} hitSlop={6}>
        <Text style={styles.retryText}>{copy.retry}</Text>
      </Pressable>
    </View>
  );
}

// Footer spinner shown while the next page loads during infinite scroll — matters
// on weak networks so the user sees the fetch is in flight.
export function ListFooterLoader({ loading }: { loading: boolean }) {
  if (!loading) return null;
  return (
    <View style={styles.footer}>
      <ActivityIndicator color={colors.greenDeep} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', paddingVertical: 56, paddingHorizontal: 24, gap: 12 },
  emptyIcon: { fontSize: 40, opacity: 0.5 },
  emptyText: { fontSize: 15, fontFamily: fonts.medium, color: colors.inkSoft, textAlign: 'center' },
  errText: { fontSize: 15, fontFamily: fonts.medium, color: colors.danger, textAlign: 'center' },
  retryBtn: {
    height: 46,
    paddingHorizontal: 24,
    borderRadius: 12,
    backgroundColor: colors.greenDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { fontSize: 15, fontFamily: fonts.bold, color: '#fff' },
  footer: { paddingVertical: 20, alignItems: 'center' },
});

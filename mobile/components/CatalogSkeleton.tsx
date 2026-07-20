import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { colors } from '../lib/theme';

// Pulsing placeholder grid shown while the first page loads (matches the web's
// SkeletonGrid intent). JS-only Animated pulse, no library.
export function SkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <View style={styles.grid}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}

function SkeletonCard() {
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View style={[styles.card, { opacity: pulse }]}>
      <View style={styles.img} />
      <View style={styles.body}>
        <View style={styles.line} />
        <View style={[styles.line, { width: '55%' }]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12 },
  card: {
    width: '48%',
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  img: { width: '100%', aspectRatio: 1, backgroundColor: colors.line },
  body: { padding: 10, gap: 8 },
  line: { height: 12, borderRadius: 6, backgroundColor: colors.line, width: '85%' },
});

import { useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { colors } from '../lib/theme';

// Full-width paged image carousel for the product detail. Each slide has a fixed
// square area with a placeholder before load / on error (weak-network friendly).
export function ImageCarousel({ images }: { images: string[] }) {
  const [width, setWidth] = useState(Dimensions.get('window').width);
  const [index, setIndex] = useState(0);
  const slides = images.length ? images : [''];

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(width, 1));
    if (i !== index) setIndex(i);
  };

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <FlatList
        data={slides}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        renderItem={({ item }) => <Slide uri={item} width={width} />}
      />
      {slides.length > 1 && (
        <View style={styles.dots} pointerEvents="none">
          {slides.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
      )}
    </View>
  );
}

function Slide({ uri, width }: { uri: string; width: number }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={[styles.slide, { width }]}>
      {uri && !failed ? (
        <Image source={{ uri }} style={styles.img} resizeMode="cover" onError={() => setFailed(true)} />
      ) : (
        <View style={styles.ph}>
          <Text style={styles.phIcon}>🥜</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slide: { aspectRatio: 1, backgroundColor: colors.sand },
  img: { width: '100%', height: '100%' },
  ph: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  phIcon: { fontSize: 48, opacity: 0.5 },
  dots: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.6)' },
  dotOn: { backgroundColor: colors.greenDeep, width: 9, height: 9, borderRadius: 5 },
});

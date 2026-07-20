import { memo, useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { cardImage, fmtMoney, type Product } from '../lib/catalog';
import { copy } from '../lib/copy';
import { colors, fonts } from '../lib/theme';
import { Money } from './Money';

type Props = {
  product: Product;
  onOpen: (p: Product) => void;
  onAdd: (p: Product) => void;
  onFav: (p: Product) => void;
  fav?: boolean;
  varietyLabel?: string; // resolved section_varieties label_ar; falls back to the raw id
};

// Grid card: single (thumbnail) image with a fixed square area (no layout jump on
// weak networks) + a clear placeholder before load / on error. Badges, price, and
// a mini + button mirror the web ProductCard. Best-seller / limited-offer badges are
// omitted here because browse_products doesn't return sold counts.
export const ProductCard = memo(function ProductCard({ product, onOpen, onAdd, onFav, fav, varietyLabel }: Props) {
  const p = product;
  const soldOut = p.stock != null && p.stock <= 0;
  const variety = varietyLabel ?? p.variety;
  return (
    <Pressable style={styles.card} onPress={() => onOpen(p)}>
      <CardImage uri={cardImage(p)} soldOut={soldOut}>
        {soldOut && (
          <View style={styles.soldTag}>
            <Text style={styles.soldTagText}>{copy.soldOut}</Text>
          </View>
        )}
        {!soldOut && p.old != null && (
          <View style={styles.saveTag}>
            <Text style={styles.tagText}>{copy.savePrice}</Text>
          </View>
        )}
        {p.bundle && (
          <View style={styles.bundleTag}>
            <Text style={styles.tagText}>{copy.bundleTag}</Text>
          </View>
        )}
        {p.pinned && <Text style={styles.pinTag}>📌</Text>}
        {!!variety && (
          <View style={styles.varietyTag}>
            <Text style={styles.varietyText}>{variety}</Text>
          </View>
        )}
        {p.shahtiStatus === 'approved' && (
          <View style={styles.shahtiTag}>
            <Text style={styles.shahtiText}>{copy.shahtiTag}</Text>
          </View>
        )}
        <Pressable style={[styles.favBtn, fav && styles.favBtnOn]} hitSlop={6} onPress={() => onFav(p)}>
          <Text style={[styles.favIcon, fav && styles.favIconOn]}>{fav ? '♥' : '♡'}</Text>
        </Pressable>
      </CardImage>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>
          {p.name.ar}
        </Text>
        {!!p.weight.ar && (
          <Text style={styles.weight} numberOfLines={1}>
            {p.weight.ar}
          </Text>
        )}
        <View style={styles.foot}>
          <View style={styles.priceWrap}>
            <Money value={p.price} size={16} />
            {p.old != null && <Text style={styles.oldPrice}>{fmtMoney(p.old)}</Text>}
          </View>
          <Pressable
            style={[styles.addBtn, soldOut && styles.addBtnDisabled]}
            disabled={soldOut}
            onPress={() => onAdd(p)}
            hitSlop={6}
          >
            <Text style={styles.addIcon}>+</Text>
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
});

function CardImage({ uri, soldOut, children }: { uri?: string; soldOut: boolean; children: ReactNode }) {
  const [failed, setFailed] = useState(false);
  return (
    <View style={styles.imgBox}>
      {uri && !failed ? (
        <Image
          source={{ uri }}
          style={[styles.img, soldOut && styles.imgDim]}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={styles.imgPlaceholder}>
          <Text style={styles.imgPlaceholderIcon}>🥜</Text>
        </View>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    // 2-column grid: consumers use space-between (FlatList columnWrapperStyle or a
    // flexWrap row), so the card owns its column width. Odd last item sits at 48%.
    width: '48%',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  // Fixed square area → the grid never reflows while images stream in.
  imgBox: { width: '100%', aspectRatio: 1, backgroundColor: colors.sand },
  img: { width: '100%', height: '100%' },
  imgDim: { opacity: 0.5 },
  imgPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.sand },
  imgPlaceholderIcon: { fontSize: 34, opacity: 0.5 },
  soldTag: {
    position: 'absolute',
    top: 8,
    insetInlineStart: 8,
    backgroundColor: colors.danger,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  soldTagText: { color: '#fff', fontSize: 12, fontFamily: fonts.bold },
  saveTag: {
    position: 'absolute',
    top: 8,
    insetInlineStart: 8,
    backgroundColor: colors.goldDeep,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  bundleTag: {
    position: 'absolute',
    top: 8,
    insetInlineStart: 8,
    marginTop: 26,
    backgroundColor: colors.green,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: { color: '#fff', fontSize: 11, fontFamily: fonts.bold },
  pinTag: { position: 'absolute', top: 8, insetInlineEnd: 40, fontSize: 14 },
  varietyTag: {
    position: 'absolute',
    bottom: 8,
    insetInlineStart: 8,
    backgroundColor: 'rgba(44,39,28,0.82)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  varietyText: { color: '#fff', fontSize: 11, fontFamily: fonts.medium },
  shahtiTag: {
    position: 'absolute',
    bottom: 8,
    insetInlineEnd: 8,
    backgroundColor: colors.greenSoft,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  shahtiText: { color: colors.greenDeep, fontSize: 10, fontFamily: fonts.bold },
  favBtn: {
    position: 'absolute',
    top: 8,
    insetInlineEnd: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  favBtnOn: { backgroundColor: colors.danger },
  favIcon: { fontSize: 16, color: colors.ink, lineHeight: 20 },
  favIconOn: { color: '#fff' },
  body: { padding: 10, gap: 4 },
  name: { fontSize: 14, fontFamily: fonts.bold, color: colors.ink, textAlign: 'right' },
  weight: { fontSize: 12, fontFamily: fonts.regular, color: colors.inkSoft, textAlign: 'right' },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  priceWrap: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  oldPrice: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: colors.muted,
    textDecorationLine: 'line-through',
  },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: colors.greenDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnDisabled: { opacity: 0.4 },
  addIcon: { color: '#fff', fontSize: 22, fontFamily: fonts.bold, lineHeight: 26 },
});

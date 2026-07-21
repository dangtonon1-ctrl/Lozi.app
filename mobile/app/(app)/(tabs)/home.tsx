import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { type ComponentProps, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, type ImageSourcePropType, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorRetry } from '../../../components/CatalogStates';
import { ProductCard } from '../../../components/ProductCard';
import { useToast } from '../../../components/Toast';
import { useAuth } from '../../../lib/auth';
import {
  browseProducts,
  browseStores,
  offersFromStores,
  withDiscount,
  type ErrKind,
  type Product,
  type StoreCard,
} from '../../../lib/catalog';
import { copy } from '../../../lib/copy';
import { useProductsRealtime } from '../../../lib/realtime';
import { colors, fonts } from '../../../lib/theme';

type Phase = 'loading' | 'ready' | 'error';

// Section tiles (web `cats` order savings/retail/raisin/almond → RTL renders
// almond…savings left-to-right). Colors are the two gradient stops of each web
// .cat-ic; the icon circle uses the first stop solid now — swap the View for a
// LinearGradient(colors) once the native batch lands (one line). Glyphs are the
// exact web CatGlyph shapes rasterized to PNG (Ionicons has no almond/raisin).
type Tile = { key: string; label: string; colors: [string, string]; icon: ImageSourcePropType; savingsTab?: boolean };
const TILES: Tile[] = [
  { key: 'savings', label: copy.secSavings, colors: ['#D9A85E', '#B9822F'], icon: require('../../../assets/cat-savings.png'), savingsTab: true },
  { key: 'retail', label: copy.secRetail, colors: ['#3C6B4A', '#26492F'], icon: require('../../../assets/cat-retail.png') },
  { key: 'raisin', label: copy.secRaisin, colors: ['#7E4A69', '#5A3049'], icon: require('../../../assets/cat-raisin.png') },
  { key: 'almond', label: copy.secAlmond, colors: ['#C89B54', '#9A6E2F'], icon: require('../../../assets/cat-almond.png') },
];

export default function Home() {
  const { role } = useAuth();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<Phase>('loading');
  const [errKind, setErrKind] = useState<ErrKind>('server');
  const [rail, setRail] = useState<Product[]>([]);
  const [featured, setFeatured] = useState<StoreCard[]>([]);

  const isVendor = !!role && role !== 'customer';

  const load = useCallback(async () => {
    // Lazy/capped (not load-all): featured stores + the almond/raisin عروض اليوم
    // rail. Rail is empty today (no almond/raisin products) — kept web-faithful.
    const [storesRes, almondRes, raisinRes] = await Promise.all([
      browseStores({ limit: 6 }),
      browseProducts({ section: 'almond', sort: 'best', limit: 8 }),
      browseProducts({ section: 'raisin', sort: 'best', limit: 8 }),
    ]);
    if (!storesRes.ok) {
      setErrKind(storesRes.kind);
      setPhase('error');
      return;
    }
    const offers = offersFromStores(storesRes.stores);
    const railRaw = [
      ...(almondRes.ok ? almondRes.products : []),
      ...(raisinRes.ok ? raisinRes.products : []),
    ];
    setFeatured(storesRes.stores);
    setRail(railRaw.map((p) => withDiscount(p, offers)).slice(0, 8));
    setPhase('ready');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rt = useProductsRealtime(load); // live updates; pauses on background

  const soon = useCallback(() => toast.show(copy.comingSoon), [toast]);
  const openProduct = useCallback((p: Product) => router.push({ pathname: '/product/[id]', params: { id: p.id } }), []);
  const openTile = useCallback(
    (tile: Tile) => {
      if (tile.savingsTab) router.navigate('/savings');
      else router.push({ pathname: '/catalog/[section]', params: { section: tile.key } });
    },
    [],
  );
  const openAll = useCallback(() => router.push({ pathname: '/catalog/[section]', params: { section: 'all' } }), []);

  const farmerSub =
    role === 'retail'
      ? copy.addProductSubRetail
      : role === 'wholesale'
        ? copy.addProductSubWholesale
        : copy.addProductSubFarmer;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 10 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* TEMP realtime diagnostic pill — remove once the cause is confirmed */}
        <View style={styles.rtDebug}>
          <Text style={styles.rtDebugText}>
            RT: {rt.status} · events:{rt.events} · last:{rt.lastAt ? new Date(rt.lastAt).toLocaleTimeString() : '—'} · token:{rt.hasToken ? 'yes' : 'no'}
          </Text>
        </View>

        {/* 1 — search + notifications */}
        <View style={styles.searchRow}>
          <Pressable style={styles.searchBox} onPress={soon}>
            <Ionicons name="search" size={18} color={colors.muted} />
            <Text style={styles.searchPlaceholder}>{copy.searchPlaceholder}</Text>
          </Pressable>
          <Pressable style={styles.bell} onPress={soon} hitSlop={6}>
            <Ionicons name="notifications-outline" size={22} color={colors.greenDeep} />
          </Pressable>
        </View>

        {/* 2 — تسوّق حسب / الأقسام */}
        <SecHead eyebrow={copy.homeShopBy} title={copy.navSections} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tileRow}>
          {TILES.map((t) => (
            <Pressable key={t.key} style={styles.tile} onPress={() => openTile(t)}>
              <View style={[styles.tileIc, { backgroundColor: t.colors[0] }]}>
                <Image source={t.icon} style={styles.tileIcImg} resizeMode="contain" />
              </View>
              <Text style={styles.tileLabel}>{t.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* 3 — طازج اليوم / عروض اليوم + عرض الكل */}
        <SecHead eyebrow={copy.homeFreshToday} title={copy.homeOffersTitle} action={copy.seeAll} onAction={openAll} />
        {phase === 'loading' ? (
          <RowLoader />
        ) : rail.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {rail.map((p) => (
              <ProductCard key={p.id} product={p} width={158} onOpen={openProduct} onAdd={soon} onFav={soon} />
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.emptyRow}>{copy.homeNoOffers}</Text>
        )}

        {/* 4 — feature banners (order + gating mirror the web) */}
        <Banner colors={['#2F5E3E', '#C08A43']} icon="pricetag-outline" title={copy.rfqTitle} subtitle={copy.rfqSub} onPress={soon} />
        {isVendor && (
          <Banner colors={['#8a5a78', '#6b3f5a']} icon="add-circle-outline" title={copy.addProductTitle} subtitle={farmerSub} onPress={soon} />
        )}
        {isVendor && (
          <Banner
            colors={['#5e4a30', '#42321e']}
            icon="business-outline"
            title={copy.secWholesale}
            subtitle={copy.wholesaleBannerSub}
            onPress={() => router.push({ pathname: '/catalog/[section]', params: { section: 'wholesale' } })}
          />
        )}

        {/* 5 — الأعلى تقييماً / متاجر مميّزة + عرض الكل */}
        <SecHead eyebrow={copy.homeTopRated} title={copy.homeFeaturedStores} action={copy.seeAll} onAction={openAll} />
        {phase === 'loading' ? (
          <RowLoader />
        ) : phase === 'error' ? (
          <ErrorRetry kind={errKind} onRetry={() => { setPhase('loading'); void load(); }} />
        ) : featured.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
            {featured.map((s) => (
              <StoreCardView key={s.vendorId} store={s} onPress={soon} />
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.emptyRow}>{copy.homeNoOffers}</Text>
        )}
      </ScrollView>

      {/* 6 — floating chat button (bottom-left) → قريباً */}
      <Pressable style={[styles.chatFab, { bottom: insets.bottom + 16 }]} onPress={soon}>
        <Ionicons name="chatbubble-ellipses" size={26} color="#fff" />
      </Pressable>
    </View>
  );
}

function SecHead({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.secHead}>
      <View style={styles.secHeadText}>
        <Text style={styles.secEyebrow}>{eyebrow}</Text>
        <Text style={styles.secTitle}>{title}</Text>
      </View>
      {action && onAction && (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.secAction}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

function Banner({
  colors: c,
  icon,
  title,
  subtitle,
  onPress,
}: {
  colors: [string, string];
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  // backgroundColor: c[0] solid now → swap to <LinearGradient colors={c}> later (one line).
  return (
    <Pressable style={[styles.banner, { backgroundColor: c[0] }]} onPress={onPress}>
      <View style={styles.bannerIc}>
        <Ionicons name={icon} size={22} color="#fff" />
      </View>
      <View style={styles.bannerTxt}>
        <Text style={styles.bannerTitle}>{title}</Text>
        <Text style={styles.bannerSub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-back" size={20} color="#fff" />
    </Pressable>
  );
}

function StoreCardView({ store, onPress }: { store: StoreCard; onPress: () => void }) {
  return (
    <Pressable style={styles.storeCard} onPress={onPress}>
      <View style={styles.storeImg}>
        {store.image ? (
          <Image source={{ uri: store.image }} style={styles.storeImgFill} resizeMode="cover" />
        ) : (
          <Text style={styles.storeImgIcon}>🥜</Text>
        )}
      </View>
      <Text style={styles.storeName} numberOfLines={1}>
        {store.name}
      </Text>
      <View style={styles.storeMeta}>
        {store.rating != null && (
          <>
            <Ionicons name="star" size={12} color={colors.goldDeep} />
            <Text style={styles.storeRating}>{store.rating.toFixed(1)}</Text>
          </>
        )}
        {store.trustedBadge && <Ionicons name="shield-checkmark" size={12} color={colors.greenDeep} />}
      </View>
    </Pressable>
  );
}

function RowLoader() {
  return (
    <View style={styles.rowLoader}>
      <ActivityIndicator color={colors.greenDeep} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  scroll: { paddingHorizontal: 16, paddingBottom: 96, gap: 6 },
  // TEMP realtime diagnostic pill styles — remove with the pill.
  rtDebug: { backgroundColor: '#1c1c1c', borderRadius: 8, paddingVertical: 5, paddingHorizontal: 10, marginBottom: 4 },
  rtDebugText: { color: '#7CFC9A', fontSize: 11, fontFamily: fonts.regular, textAlign: 'left' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 46,
    borderRadius: 14,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  searchPlaceholder: { fontSize: 14, fontFamily: fonts.regular, color: colors.muted, flex: 1 },
  bell: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  secHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 14, marginBottom: 8 },
  secHeadText: { gap: 1 },
  secEyebrow: { fontSize: 12, fontFamily: fonts.medium, color: colors.goldDeep },
  secTitle: { fontSize: 18, fontFamily: fonts.bold, color: colors.ink },
  secAction: { fontSize: 13, fontFamily: fonts.bold, color: colors.greenDeep },
  tileRow: { flexDirection: 'row', gap: 12, paddingVertical: 2 },
  tile: { alignItems: 'center', gap: 6, width: 76 },
  tileIc: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  tileIcImg: { width: 30, height: 30 },
  tileLabel: { fontSize: 13, fontFamily: fonts.bold, color: colors.ink },
  rail: { flexDirection: 'row', gap: 12, paddingVertical: 2 },
  emptyRow: { fontSize: 14, fontFamily: fonts.medium, color: colors.inkSoft, textAlign: 'center', paddingVertical: 24 },
  rowLoader: { paddingVertical: 28, alignItems: 'center' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  bannerIc: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTxt: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: 16, fontFamily: fonts.bold, color: '#fff' },
  bannerSub: { fontSize: 12, fontFamily: fonts.regular, color: 'rgba(255,255,255,0.9)' },
  storeCard: { width: 130, gap: 6 },
  storeImg: {
    width: 130,
    height: 90,
    borderRadius: 14,
    backgroundColor: colors.sand,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  storeImgFill: { width: '100%', height: '100%' },
  storeImgIcon: { fontSize: 30, opacity: 0.5 },
  storeName: { fontSize: 14, fontFamily: fonts.bold, color: colors.ink },
  storeMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  storeRating: { fontSize: 12, fontFamily: fonts.medium, color: colors.inkSoft },
  chatFab: {
    position: 'absolute',
    left: 16,
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.greenDeep,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});

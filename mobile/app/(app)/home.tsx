import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { SkeletonGrid } from '../../components/CatalogSkeleton';
import { EmptyState, ErrorRetry } from '../../components/CatalogStates';
import { ProductCard } from '../../components/ProductCard';
import { useToast } from '../../components/Toast';
import { useAuth } from '../../lib/auth';
import { browseProducts, loadSectionVarieties, loadStores, type ErrKind, type Product } from '../../lib/catalog';
import { copy } from '../../lib/copy';
import { colors, fonts } from '../../lib/theme';

type Phase = 'loading' | 'ready' | 'error';

// Catalog home. Primary content is the retail catalog (browse-all), which doubles
// as the DB + image connectivity check. Wholesale is a gated entry. The
// almond/raisin section cards are intentionally dropped — production has no such
// products yet (see 10-web-parity-gaps.md); sections return once data is
// categorized. Sort/filter/infinite-scroll live on the dedicated browse screen
// (increment 3); product detail and cart/favorites wiring come later (5 / cart),
// so open/add/fav currently flash قريباً.
export default function Home() {
  const { role, logout } = useAuth();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('loading');
  const [errKind, setErrKind] = useState<ErrKind>('server');
  const [products, setProducts] = useState<Product[]>([]);
  const [varLabels, setVarLabels] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [storesRes, vars] = await Promise.all([loadStores(), loadSectionVarieties()]);
    const offers = storesRes.ok ? storesRes.storeOffers : {};
    const res = await browseProducts({ section: null, sort: 'best', limit: 24 }, offers);
    if (!res.ok) {
      setErrKind(res.kind);
      setPhase('error');
      return;
    }
    const vmap: Record<string, string> = {};
    for (const v of vars) vmap[v.variety_id] = v.label_ar;
    setVarLabels(vmap);
    setProducts(res.products);
    setPhase('ready');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const retry = useCallback(() => {
    setPhase('loading');
    void load();
  }, [load]);

  const soon = useCallback(() => toast.show(copy.comingSoon), [toast]);
  const canSeeWholesale = !!role && role !== 'customer';

  return (
    <FlatList
      data={phase === 'ready' ? products : []}
      keyExtractor={(p) => p.id}
      numColumns={2}
      columnWrapperStyle={styles.column}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.greenDeep}
          colors={[colors.greenDeep]}
        />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.topbar}>
            <Text style={styles.brand}>لوزي</Text>
            <Pressable onPress={logout} hitSlop={8} style={styles.logout}>
              <Text style={styles.logoutText}>{copy.signOut}</Text>
            </Pressable>
          </View>
          {canSeeWholesale && (
            <Pressable
              style={styles.wholesaleCard}
              onPress={() => router.push({ pathname: '/catalog/[section]', params: { section: 'wholesale' } })}
            >
              <Text style={styles.wholesaleText}>{copy.secWholesale}</Text>
              <Text style={styles.wholesaleArrow}>‹</Text>
            </Pressable>
          )}
          <View style={styles.titleRow}>
            <Text style={styles.title}>{copy.catalogTitle}</Text>
            <Pressable
              onPress={() => router.push({ pathname: '/catalog/[section]', params: { section: 'all' } })}
              hitSlop={8}
            >
              <Text style={styles.seeAll}>{copy.browseAll} ‹</Text>
            </Pressable>
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <ProductCard
          product={item}
          fav={false}
          varietyLabel={item.variety ? varLabels[item.variety] : undefined}
          onOpen={soon}
          onAdd={soon}
          onFav={soon}
        />
      )}
      ListEmptyComponent={
        phase === 'loading' ? (
          <SkeletonGrid />
        ) : phase === 'error' ? (
          <ErrorRetry kind={errKind} onRetry={retry} />
        ) : (
          <EmptyState />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 40, backgroundColor: colors.cream },
  column: { justifyContent: 'space-between', marginBottom: 12 },
  header: { paddingTop: 40, gap: 14, marginBottom: 4 },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontSize: 30, fontFamily: fonts.extraBold, color: colors.greenDeep },
  logout: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, borderColor: colors.line },
  logoutText: { fontSize: 13, fontFamily: fonts.bold, color: colors.danger },
  wholesaleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.greenSoft,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  wholesaleText: { fontSize: 16, fontFamily: fonts.bold, color: colors.greenDeep },
  wholesaleArrow: { fontSize: 20, fontFamily: fonts.bold, color: colors.greenDeep },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontFamily: fonts.bold, color: colors.ink },
  seeAll: { fontSize: 14, fontFamily: fonts.bold, color: colors.greenDeep },
});

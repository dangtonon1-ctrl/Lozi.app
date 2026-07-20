import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { SkeletonGrid } from '../../../components/CatalogSkeleton';
import { EmptyState, ErrorRetry, ListFooterLoader } from '../../../components/CatalogStates';
import { activeFilterCount, CatalogFilters, EMPTY_FILTERS, FilterSheet } from '../../../components/FilterSheet';
import { ProductCard } from '../../../components/ProductCard';
import { SortSheet } from '../../../components/SortSheet';
import { useToast } from '../../../components/Toast';
import {
  browseProducts,
  loadSectionVarieties,
  loadStores,
  type ErrKind,
  type Product,
  type Sort,
  type StoreOffers,
} from '../../../lib/catalog';
import { copy } from '../../../lib/copy';
import { colors, fonts } from '../../../lib/theme';

const PAGE = 24;
type Phase = 'loading' | 'ready' | 'error';

// Dedicated browse screen: sort + filters + infinite scroll (24/page) + a footer
// loader on every page (weak-network feedback) + pull-to-refresh. section = 'all'
// (p_section null) | 'wholesale' | a category. Product open / add / fav still flash
// قريباً until the detail (inc 5) and cart tasks wire them.
export default function CatalogBrowse() {
  const params = useLocalSearchParams<{ section?: string }>();
  const sectionKey = typeof params.section === 'string' ? params.section : 'all';
  const toast = useToast();

  const [sort, setSort] = useState<Sort>('best');
  const [filters, setFilters] = useState<CatalogFilters>(EMPTY_FILTERS);
  const [products, setProducts] = useState<Product[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [errKind, setErrKind] = useState<ErrKind>('server');
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [varLabels, setVarLabels] = useState<Record<string, string>>({});
  const [sectionVars, setSectionVars] = useState<{ id: string; label: string }[]>([]);

  const offersRef = useRef<StoreOffers>({});
  const offsetRef = useRef(0);
  const sortRef = useRef(sort);
  sortRef.current = sort;
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const metaReadyRef = useRef(false);

  const fetchPage = useCallback(
    async (mode: 'reset' | 'more', silent = false) => {
      if (mode === 'reset') {
        offsetRef.current = 0;
        if (!silent) setPhase('loading');
      } else {
        setLoadingMore(true);
      }
      const f = filtersRef.current;
      const res = await browseProducts(
        {
          section: sectionKey === 'all' ? null : sectionKey,
          sort: sortRef.current,
          varieties: f.varieties,
          priceMin: f.priceMin ? Number(f.priceMin) : null,
          priceMax: f.priceMax ? Number(f.priceMax) : null,
          shahti: f.shahti,
          freeDelivery: f.freeDelivery,
          bundle: f.bundle,
          discount: f.discount,
          limit: PAGE,
          offset: offsetRef.current,
        },
        offersRef.current,
      );
      if (!res.ok) {
        setErrKind(res.kind);
        if (mode === 'reset' && !silent) setPhase('error');
        setLoadingMore(false);
        return;
      }
      offsetRef.current += res.products.length;
      setProducts((prev) => (mode === 'reset' ? res.products : [...prev, ...res.products]));
      setHasMore(res.products.length === PAGE);
      setPhase('ready');
      setLoadingMore(false);
    },
    [sectionKey],
  );

  // Load offers + variety labels, then the first page. Re-runs if the section changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storesRes, vars] = await Promise.all([loadStores(), loadSectionVarieties()]);
      if (cancelled) return;
      offersRef.current = storesRes.ok ? storesRes.storeOffers : {};
      const vmap: Record<string, string> = {};
      const secList: { id: string; label: string }[] = [];
      for (const v of vars) {
        vmap[v.variety_id] = v.label_ar;
        if (v.section === sectionKey) secList.push({ id: v.variety_id, label: v.label_ar });
      }
      setVarLabels(vmap);
      setSectionVars(secList);
      metaReadyRef.current = true;
      await fetchPage('reset');
    })();
    return () => {
      cancelled = true;
    };
  }, [sectionKey, fetchPage]);

  // Re-fetch from the top when sort or filters change (after the initial load).
  useEffect(() => {
    if (!metaReadyRef.current) return;
    void fetchPage('reset');
  }, [sort, filters, fetchPage]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchPage('reset', true);
    setRefreshing(false);
  }, [fetchPage]);

  const onEndReached = useCallback(() => {
    if (phase === 'ready' && hasMore && !loadingMore && !refreshing) void fetchPage('more');
  }, [phase, hasMore, loadingMore, refreshing, fetchPage]);

  const soon = useCallback(() => toast.show(copy.comingSoon), [toast]);
  const openProduct = useCallback(
    (prod: Product) => router.push({ pathname: '/product/[id]', params: { id: prod.id } }),
    [],
  );
  const fcount = activeFilterCount(filters);
  const title = sectionKey === 'all' ? copy.browseAll : sectionKey === 'wholesale' ? copy.secWholesale : sectionKey;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerBtns}>
          <Pressable onPress={() => setSortOpen(true)} style={styles.hBtn}>
            <Text style={styles.hBtnText}>{copy.sortTitle}</Text>
          </Pressable>
          <Pressable onPress={() => setFilterOpen(true)} style={styles.hBtn}>
            <Text style={styles.hBtnText}>{copy.filterTitle}</Text>
            {fcount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{fcount}</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>

      <FlatList
        data={phase === 'ready' ? products : []}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={styles.column}
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.greenDeep} colors={[colors.greenDeep]} />
        }
        renderItem={({ item }) => (
          <ProductCard
            product={item}
            fav={false}
            varietyLabel={item.variety ? varLabels[item.variety] : undefined}
            onOpen={openProduct}
            onAdd={soon}
            onFav={soon}
          />
        )}
        ListFooterComponent={<ListFooterLoader loading={loadingMore} />}
        ListEmptyComponent={
          phase === 'loading' ? (
            <SkeletonGrid />
          ) : phase === 'error' ? (
            <ErrorRetry kind={errKind} onRetry={() => void fetchPage('reset')} />
          ) : (
            <EmptyState />
          )
        }
      />

      <SortSheet visible={sortOpen} value={sort} onSelect={setSort} onClose={() => setSortOpen(false)} />
      <FilterSheet
        visible={filterOpen}
        value={filters}
        varieties={sectionVars}
        onApply={setFilters}
        onClose={() => setFilterOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 44,
    paddingBottom: 10,
    paddingHorizontal: 16,
    backgroundColor: colors.cream,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  backBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  back: { fontSize: 26, fontFamily: fonts.bold, color: colors.greenDeep },
  title: { flex: 1, fontSize: 18, fontFamily: fonts.bold, color: colors.ink },
  headerBtns: { flexDirection: 'row', gap: 8 },
  hBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  hBtnText: { fontSize: 13, fontFamily: fonts.bold, color: colors.greenDeep },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: colors.greenDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, fontFamily: fonts.bold, color: '#fff' },
  list: { padding: 16, paddingBottom: 40 },
  column: { justifyContent: 'space-between', marginBottom: 12 },
});

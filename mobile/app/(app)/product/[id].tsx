import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorRetry } from '../../../components/CatalogStates';
import { ImageCarousel } from '../../../components/ImageCarousel';
import { Money } from '../../../components/Money';
import { useToast } from '../../../components/Toast';
import { detailImages, fmtMoney, loadProduct, type ErrKind, type ProductDetail } from '../../../lib/catalog';
import { copy } from '../../../lib/copy';
import { colors, fonts } from '../../../lib/theme';

type Phase = 'loading' | 'ready' | 'error';

// Product detail: full image carousel + fields. Add-to-cart / favorite flash
// قريباً until the cart task wires them.
export default function ProductScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>('loading');
  const [errKind, setErrKind] = useState<ErrKind>('server');
  const [notFound, setNotFound] = useState(false);
  const [detail, setDetail] = useState<ProductDetail | null>(null);

  const load = useCallback(async () => {
    setPhase('loading');
    setNotFound(false);
    const res = await loadProduct(id);
    if (!res.ok) {
      if (res.kind === 'not_found') setNotFound(true);
      else setErrKind(res.kind);
      setPhase('error');
      return;
    }
    setDetail(res.detail);
    setPhase('ready');
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const soon = useCallback(() => toast.show(copy.comingSoon), [toast]);

  const p = detail?.product;
  const soldOut = !!p && p.stock != null && p.stock <= 0;

  return (
    <View style={styles.screen}>
      <View style={styles.topbar}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.iconBtn}>
          <Text style={styles.back}>‹</Text>
        </Pressable>
        <Pressable onPress={soon} hitSlop={8} style={styles.iconBtn}>
          <Text style={styles.fav}>♡</Text>
        </Pressable>
      </View>

      {phase === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.greenDeep} />
        </View>
      )}

      {phase === 'error' &&
        (notFound ? <EmptyState label={copy.productNotFound} /> : <ErrorRetry kind={errKind} onRetry={load} />)}

      {phase === 'ready' && p && (
        <>
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            <ImageCarousel images={detailImages(p)} />
            <View style={styles.content}>
              <Text style={styles.name}>{p.name.ar}</Text>
              {!!detail?.store?.name && <Text style={styles.store}>{detail.store.name}</Text>}
              <View style={styles.priceRow}>
                <Money value={p.price} size={24} color={colors.greenDeep} />
                {p.old != null && <Text style={styles.old}>{fmtMoney(p.old)}</Text>}
              </View>
              <View style={styles.tags}>
                {!!p.weight.ar && <Tag text={p.weight.ar} />}
                {p.shahtiStatus === 'approved' && <Tag text={copy.shahtiTag} tone="green" />}
                {soldOut && <Tag text={copy.soldOut} tone="danger" />}
              </View>
              {!!p.desc?.ar && <Text style={styles.desc}>{p.desc.ar}</Text>}
            </View>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={[styles.addBtn, soldOut && styles.addBtnDisabled]} disabled={soldOut} onPress={soon}>
              <Text style={styles.addText}>{soldOut ? copy.soldOut : copy.addToCart}</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

function Tag({ text, tone }: { text: string; tone?: 'green' | 'danger' }) {
  return (
    <View style={[styles.tag, tone === 'green' && styles.tagGreen, tone === 'danger' && styles.tagDanger]}>
      <Text
        style={[styles.tagText, tone === 'green' && styles.tagTextGreen, tone === 'danger' && styles.tagTextDanger]}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.cream },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 44,
    paddingBottom: 8,
    paddingHorizontal: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  back: { fontSize: 24, fontFamily: fonts.bold, color: colors.greenDeep },
  fav: { fontSize: 18, color: colors.ink },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingBottom: 24 },
  content: { padding: 20, gap: 12 },
  name: { fontSize: 22, fontFamily: fonts.bold, color: colors.ink, textAlign: 'right' },
  store: { fontSize: 14, fontFamily: fonts.medium, color: colors.inkSoft, textAlign: 'right' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  old: { fontSize: 16, fontFamily: fonts.regular, color: colors.muted, textDecorationLine: 'line-through' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { backgroundColor: colors.sand, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 12 },
  tagGreen: { backgroundColor: colors.greenSoft },
  tagDanger: { backgroundColor: '#F7E3DE' },
  tagText: { fontSize: 13, fontFamily: fonts.medium, color: colors.inkSoft },
  tagTextGreen: { color: colors.greenDeep, fontFamily: fonts.bold },
  tagTextDanger: { color: colors.danger, fontFamily: fonts.bold },
  desc: { fontSize: 15, fontFamily: fonts.regular, color: colors.ink, textAlign: 'right', lineHeight: 24, marginTop: 4 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.cream },
  addBtn: { height: 54, borderRadius: 16, backgroundColor: colors.greenDeep, alignItems: 'center', justifyContent: 'center' },
  addBtnDisabled: { opacity: 0.4 },
  addText: { fontSize: 17, fontFamily: fonts.bold, color: '#fff' },
});

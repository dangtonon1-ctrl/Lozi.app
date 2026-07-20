import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { copy } from '../lib/copy';
import { normalizeDigits } from '../lib/normalizeDigits';
import { colors, fonts } from '../lib/theme';

export type CatalogFilters = {
  varieties: string[];
  priceMin: string;
  priceMax: string;
  shahti: boolean;
  freeDelivery: boolean;
  bundle: boolean;
  discount: boolean;
};

export const EMPTY_FILTERS: CatalogFilters = {
  varieties: [],
  priceMin: '',
  priceMax: '',
  shahti: false,
  freeDelivery: false,
  bundle: false,
  discount: false,
};

// Count of active filters — drives the filter button's badge (mirrors the web).
export function activeFilterCount(f: CatalogFilters): number {
  return (
    (f.varieties.length ? 1 : 0) +
    (f.priceMin !== '' || f.priceMax !== '' ? 1 : 0) +
    (f.shahti ? 1 : 0) +
    (f.freeDelivery ? 1 : 0) +
    (f.bundle ? 1 : 0) +
    (f.discount ? 1 : 0)
  );
}

export function FilterSheet({
  visible,
  value,
  varieties,
  onApply,
  onClose,
}: {
  visible: boolean;
  value: CatalogFilters;
  varieties: { id: string; label: string }[];
  onApply: (f: CatalogFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<CatalogFilters>(value);
  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  const toggleVariety = (id: string) =>
    setDraft((d) => ({
      ...d,
      varieties: d.varieties.includes(id) ? d.varieties.filter((v) => v !== id) : [...d.varieties, id],
    }));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.title}>{copy.filterTitle}</Text>
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.scroll}>
          {varieties.length > 0 && (
            <View style={styles.group}>
              <Text style={styles.groupLabel}>{copy.filterVariety}</Text>
              <View style={styles.chips}>
                {varieties.map((v) => {
                  const on = draft.varieties.includes(v.id);
                  return (
                    <Pressable key={v.id} style={[styles.chip, on && styles.chipOn]} onPress={() => toggleVariety(v.id)}>
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{v.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}

          <View style={styles.group}>
            <Text style={styles.groupLabel}>{copy.filterPriceFrom} / {copy.filterPriceTo}</Text>
            <View style={styles.priceRow}>
              <TextInput
                style={styles.priceInput}
                value={draft.priceMin}
                onChangeText={(t) => setDraft((d) => ({ ...d, priceMin: normalizeDigits(t).replace(/[^0-9]/g, '') }))}
                placeholder={copy.filterPriceFrom}
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
              />
              <Text style={styles.dash}>—</Text>
              <TextInput
                style={styles.priceInput}
                value={draft.priceMax}
                onChangeText={(t) => setDraft((d) => ({ ...d, priceMax: normalizeDigits(t).replace(/[^0-9]/g, '') }))}
                placeholder={copy.filterPriceTo}
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
              />
            </View>
          </View>

          <ToggleRow label={copy.filterFreeDelivery} on={draft.freeDelivery} onToggle={() => setDraft((d) => ({ ...d, freeDelivery: !d.freeDelivery }))} />
          <ToggleRow label={copy.filterShahti} on={draft.shahti} onToggle={() => setDraft((d) => ({ ...d, shahti: !d.shahti }))} />
          <ToggleRow label={copy.filterDiscount} on={draft.discount} onToggle={() => setDraft((d) => ({ ...d, discount: !d.discount }))} />
          <ToggleRow label={copy.filterBundle} on={draft.bundle} onToggle={() => setDraft((d) => ({ ...d, bundle: !d.bundle }))} />
        </ScrollView>

        <View style={styles.foot}>
          <Pressable style={styles.clearBtn} onPress={() => setDraft(EMPTY_FILTERS)}>
            <Text style={styles.clearText}>{copy.filterClear}</Text>
          </Pressable>
          <Pressable
            style={styles.applyBtn}
            onPress={() => {
              onApply(draft);
              onClose();
            }}
          >
            <Text style={styles.applyText}>{copy.filterApply}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function ToggleRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <Pressable style={styles.toggleRow} onPress={onToggle}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <View style={[styles.checkbox, on && styles.checkboxOn]}>{on && <Text style={styles.checkboxTick}>✓</Text>}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: '82%',
  },
  scroll: { flexGrow: 0 },
  title: { fontSize: 17, fontFamily: fonts.bold, color: colors.ink, textAlign: 'center', marginBottom: 10 },
  group: { gap: 8, marginBottom: 16 },
  groupLabel: { fontSize: 14, fontFamily: fonts.bold, color: colors.inkSoft },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderColor: colors.line, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 16, backgroundColor: colors.surface },
  chipOn: { backgroundColor: colors.greenDeep, borderColor: colors.greenDeep },
  chipText: { fontSize: 14, fontFamily: fonts.medium, color: colors.inkSoft },
  chipTextOn: { color: '#fff' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  priceInput: {
    flex: 1,
    height: 48,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
    fontFamily: fonts.regular,
    color: colors.ink,
    backgroundColor: colors.surface,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  dash: { fontSize: 16, color: colors.muted },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  toggleLabel: { fontSize: 15, fontFamily: fonts.medium, color: colors.ink },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  checkboxOn: { backgroundColor: colors.greenDeep, borderColor: colors.greenDeep },
  checkboxTick: { color: '#fff', fontSize: 14, fontFamily: fonts.bold },
  foot: { flexDirection: 'row', gap: 12, marginTop: 8 },
  clearBtn: { flex: 1, height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: 15, fontFamily: fonts.bold, color: colors.inkSoft },
  applyBtn: { flex: 2, height: 50, borderRadius: 14, backgroundColor: colors.greenDeep, alignItems: 'center', justifyContent: 'center' },
  applyText: { fontSize: 16, fontFamily: fonts.bold, color: '#fff' },
});

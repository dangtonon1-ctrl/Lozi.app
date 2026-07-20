import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Sort } from '../lib/catalog';
import { copy } from '../lib/copy';
import { colors, fonts } from '../lib/theme';

const OPTIONS: { key: Sort; label: string }[] = [
  { key: 'best', label: copy.sortBest },
  { key: 'price_asc', label: copy.sortPriceAsc },
  { key: 'price_desc', label: copy.sortPriceDesc },
  { key: 'rating', label: copy.sortRating },
  { key: 'newest', label: copy.sortNewest },
];

export function SortSheet({
  visible,
  value,
  onSelect,
  onClose,
}: {
  visible: boolean;
  value: Sort;
  onSelect: (s: Sort) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <Text style={styles.title}>{copy.sortTitle}</Text>
        {OPTIONS.map((o) => {
          const on = value === o.key;
          return (
            <Pressable
              key={o.key}
              style={styles.row}
              onPress={() => {
                onSelect(o.key);
                onClose();
              }}
            >
              <Text style={[styles.rowText, on && styles.rowTextOn]}>{o.label}</Text>
              {on && <Text style={styles.check}>✓</Text>}
            </Pressable>
          );
        })}
      </View>
    </Modal>
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
    paddingBottom: 32,
    gap: 4,
  },
  title: { fontSize: 17, fontFamily: fonts.bold, color: colors.ink, textAlign: 'center', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  rowText: { fontSize: 16, fontFamily: fonts.medium, color: colors.ink },
  rowTextOn: { fontFamily: fonts.bold, color: colors.greenDeep },
  check: { fontSize: 16, fontFamily: fonts.bold, color: colors.greenDeep },
});

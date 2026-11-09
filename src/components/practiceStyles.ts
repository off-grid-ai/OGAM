import { StyleSheet } from 'react-native';
import type { useTheme } from '../theme';

export type Colors = ReturnType<typeof useTheme>['colors'];
export const good = '#16A34A';
/** Layout shared by the practice screens and the answer widgets. */
export const st = StyleSheet.create({
  flex: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', padding: 12 }, title: { fontSize: 18, marginLeft: 12 }, content: { padding: 16, paddingBottom: 120 },
  choice: { borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 6 }, input: { borderWidth: 1, borderRadius: 8, padding: 10 },
  pill: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, margin: 3 }, wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  top4: { marginTop: 4 }, top6: { marginTop: 6 }, top8: { marginTop: 8 }, top10: { marginTop: 10 }, top12: { marginTop: 12 }, top14: { marginTop: 14 }, top18: { marginTop: 18 }, pad8: { paddingVertical: 8 },
  gap: { marginLeft: 8 }, semi: { fontWeight: '600' }, small12: { fontSize: 12 }, small13: { fontSize: 13 }, prompt: { fontSize: 17, marginTop: 6 },
});


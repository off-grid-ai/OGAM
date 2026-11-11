import React, { useMemo, useState } from 'react';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { LANGUAGES, languageService } from './languageService';
import { useLanguage } from './store';
import { speakVaried } from './voices';

type Sort = 'az' | 'due';
const DAY = 864e5;

/** "Due now", "Due tomorrow", "Due in 4 days", or "Not practised yet". */
export function dueText(due: number | null, now = Date.now()): string {
  if (due === null) return 'Not practised yet';
  const days = Math.ceil((due - now) / DAY);
  if (days <= 0) return 'Due now';
  return days === 1 ? 'Due tomorrow' : `Due in ${days} days`;
}

/**
 * The word book: every word learned so far, with its meaning, a play button, how well it is
 * known (five dots, one per review box) and when it comes back for review. Search in either
 * language; sort A to Z or by what is due first.
 */
export const WordBookScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const code = useLanguage((s) => s.language);
  useLanguage((s) => s.memory);
  const langName = LANGUAGES.find((l) => l.code === code)?.name ?? code;
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('az');
  const all = languageService.wordBook(code);
  const words = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const hits = q ? all.filter((w) => w.t.toLocaleLowerCase().includes(q) || w.en.toLocaleLowerCase().includes(q)) : all;
    return [...hits].sort(sort === 'az'
      ? (a, b) => a.t.localeCompare(b.t)
      : (a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || a.box - b.box);
  }, [all, query, sort]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={20} color={colors.text} /></TouchableOpacity>
        <Text style={styles.title}>Word book</Text>
        <Text style={styles.meta}>{all.length} words</Text>
      </View>
      <View style={styles.tools}>
        <TextInput value={query} onChangeText={setQuery} placeholder={`Search in ${langName} or English`} placeholderTextColor={colors.textMuted}
          style={styles.search} testID="wordbook-search" autoCapitalize="none" autoCorrect={false} />
        <View style={styles.sorts}>
          {(['az', 'due'] as Sort[]).map((x) => (
            <TouchableOpacity key={x} onPress={() => setSort(x)} style={[styles.chip, sort === x && styles.chipOn]} testID={`wordbook-sort-${x}`}>
              <Text style={sort === x ? styles.chipTextOn : styles.chipText}>{x === 'az' ? 'A to Z' : 'Due first'}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <FlatList
        data={words}
        keyExtractor={(w) => w.t}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>{all.length ? 'No words match.' : 'Finish a lesson and its words appear here.'}</Text>}
        renderItem={({ item }) => (
          <View style={styles.row} testID={`word-${item.t}`}>
            <TouchableOpacity onPress={() => speakVaried(item.t, code, 'lesson')} accessibilityLabel={`Play ${item.t}`}>
              <Icon name="volume-2" size={18} color={colors.primary} />
            </TouchableOpacity>
            <View style={styles.text}>
              <Text style={styles.word}>{item.t}</Text>
              {!!item.r && <Text style={styles.meta}>{item.r}</Text>}
              <Text style={styles.meaning}>{item.en}</Text>
            </View>
            <View style={styles.right}>
              <View style={styles.dots} accessibilityLabel={`Known ${item.box} of 5`}>
                {[1, 2, 3, 4, 5].map((n) => <View key={n} style={[styles.dot, n <= item.box && styles.dotOn]} />)}
              </View>
              <Text style={styles.meta}>{dueText(item.due)}</Text>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  title: { ...TYPOGRAPHY.h2, flex: 1, color: colors.text },
  tools: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.md, gap: SPACING.sm },
  search: { ...TYPOGRAPHY.body, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: SPACING.md },
  sorts: { flexDirection: 'row' as const, gap: SPACING.sm },
  chip: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...TYPOGRAPHY.bodySmall, color: colors.text },
  chipTextOn: { ...TYPOGRAPHY.bodySmall, color: colors.background },
  list: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md, paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  text: { flex: 1 },
  word: { ...TYPOGRAPHY.h3, color: colors.text },
  meaning: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  right: { alignItems: 'flex-end' as const, gap: SPACING.xs },
  dots: { flexDirection: 'row' as const, gap: 3 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.border },
  dotOn: { backgroundColor: colors.primary },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  empty: { ...TYPOGRAPHY.body, color: colors.textMuted, textAlign: 'center' as const, marginTop: SPACING.xl },
});

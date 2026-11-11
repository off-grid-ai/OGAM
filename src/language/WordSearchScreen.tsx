import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { Button } from '../components/Button';
import { LANGUAGES, PRACTICE, languageService } from './languageService';
import { useLanguage } from './store';
import { buildLangWordSearch, searchWords, wordAt, type LangWordSearch } from './wordSearch';
import type { Item } from './lessons';
import { playFeedback } from './sounds';

/**
 * Word search square on the board: find the words from the English list hidden in the grid
 * in the language being learned. Tap a word's first letter, then its last.
 */
export const WordSearchScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { unitId, key } = useRoute<any>().params as { unitId: string; key?: string };
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const code = useLanguage((s) => s.language);
  const langName = LANGUAGES.find((l) => l.code === code)?.name ?? code;
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [first, setFirst] = useState<number | null>(null);
  const [found, setFound] = useState<{ id: number; cells: number[] }[]>([]);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    // Words from this stretch of the board, plus every word learned so far.
    languageService.unitWords(unitId)
      .then((unit) => setItems([...unit, ...languageService.knownItems(code)]))
      .catch((e) => setError(String(e?.message || e)));
  }, [unitId, code]);
  const puzzle: LangWordSearch | null = useMemo(() => (items ? buildLangWordSearch(items) : null), [items]);
  const cell = puzzle ? Math.floor((Math.min(width, 520) - SPACING.lg * 2) / puzzle.size) : 0;
  const shown = new Set(found.flatMap((f) => f.cells));
  const isFound = (id: number) => found.some((f) => f.id === id);

  const finish = (n: number) => {
    if (key) languageService.completeSpace(key);
    languageService.finishLesson(PRACTICE, { right: n, total: puzzle?.hidden.length ?? n });
    setFinished(true);
  };
  const tap = (i: number) => {
    if (!puzzle || finished) return;
    if (first === null) { setFirst(i); return; }
    const hit = wordAt(puzzle, [first, i], puzzle.hidden.filter((h) => !isFound(h.id)));
    setFirst(null);
    playFeedback(!!hit);
    if (!hit) return;
    const next = [...found, { id: hit.hidden.id, cells: hit.cells }];
    setFound(next);
    if (next.length === puzzle.hidden.length) finish(next.length);
  };

  if (error || !puzzle) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          {error ? <Text style={styles.body}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
          <Button title="Back" variant="ghost" onPress={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    );
  }
  if (searchWords(items ?? [], puzzle.size).length < 3) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.body}>Learn a few more single words first, then this word search fills up.</Text>
          <Button title="Skip this square" onPress={() => { if (key) languageService.completeSpace(key); navigation.goBack(); }} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={20} color={colors.text} /></TouchableOpacity>
        <Text style={styles.title}>Word search</Text>
        <Text style={styles.meta}>{found.length} of {puzzle.hidden.length}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.meta}>Find these words in {langName}. Tap the first letter, then the last.</Text>
        <View style={styles.bank}>
          {puzzle.hidden.map((h) => (
            <Text key={h.id} style={isFound(h.id) ? styles.bankDone : styles.bankWord}>
              {h.en}{isFound(h.id) ? ` = ${h.word.toLocaleLowerCase()}` : ''}
            </Text>
          ))}
        </View>
        <View style={[styles.grid, { width: cell * puzzle.size }]} testID="wordsearch-grid">
          {puzzle.cells.map((ch, i) => (
            <TouchableOpacity key={i} onPress={() => tap(i)} accessibilityLabel={`${ch} ${Math.floor(i / puzzle.size) + 1}-${(i % puzzle.size) + 1}`}
              style={[styles.cell, { width: cell, height: cell }, shown.has(i) && styles.cellFound, first === i && styles.cellFirst]}>
              <Text style={styles.letter}>{ch}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {finished
          ? <Button title="Back to the board" onPress={() => navigation.goBack()} testID="wordsearch-done" />
          : <Button title="Finish" variant="outline" onPress={() => finish(found.length)} />}
      </ScrollView>
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
  content: { padding: SPACING.lg, gap: SPACING.md, alignItems: 'center' as const },
  center: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, padding: SPACING.xl, gap: SPACING.md },
  body: { ...TYPOGRAPHY.body, color: colors.text, textAlign: 'center' as const },
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  bank: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACING.sm, justifyContent: 'center' as const },
  bankWord: { ...TYPOGRAPHY.bodySmall, color: colors.text },
  bankDone: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, textDecorationLine: 'line-through' as const },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const },
  cell: { alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border },
  cellFound: { backgroundColor: `${colors.success}55` },
  cellFirst: { backgroundColor: `${colors.primary}66` },
  letter: { ...TYPOGRAPHY.body, color: colors.text },
});

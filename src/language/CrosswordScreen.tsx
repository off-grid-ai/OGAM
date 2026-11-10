import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { Button } from '../components/Button';
import { LANGUAGES, PRACTICE, languageService } from './languageService';
import { useLanguage } from './store';
import { buildCrossword, entryCells, isAnswer, type Crossword } from './crossword';
import type { Item } from './lessons';
import { playFeedback } from './sounds';
import { speakIn } from '../atlasVoice/tts';

/**
 * Crossword square on the board (optional: Skip moves on). The clues are in English and the answers
 * go in the language being learned. Tap a clue, type the answer, Check; Hint fills the first letter.
 */
export const CrosswordScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { unitId, key } = useRoute<any>().params as { unitId: string; key?: string };
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { width } = useWindowDimensions();
  const code = useLanguage((s) => s.language);
  const langName = LANGUAGES.find((l) => l.code === code)?.name ?? code;
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [typed, setTyped] = useState('');
  const [solved, setSolved] = useState<number[]>([]);
  const [hinted, setHinted] = useState<number[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    // Words from this stretch of the board, plus every word learned so far.
    languageService.unitWords(unitId)
      .then((unit) => setItems([...unit, ...languageService.knownItems(code)]))
      .catch((e) => setError(String(e?.message || e)));
  }, [unitId, code]);
  const puzzle: Crossword | null = useMemo(() => (items ? buildCrossword(items) : null), [items]);
  const cell = puzzle ? Math.floor(Math.min(Math.min(width, 520) - SPACING.lg * 2, 36 * puzzle.cols) / puzzle.cols) : 0;

  const skip = () => { if (key) languageService.completeSpace(key); navigation.goBack(); };
  const finish = (n: number) => {
    if (key) languageService.completeSpace(key);
    languageService.finishLesson(PRACTICE, { right: n, total: puzzle?.entries.length ?? n });
    setFinished(true);
  };

  if (error || !puzzle) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          {error ? <Text style={styles.body}>{error}</Text>
            : items ? <Text style={styles.body}>Learn a few more words first, then this crossword fills up.</Text>
              : <ActivityIndicator color={colors.primary} />}
          <Button title="Skip this square" onPress={skip} testID="crossword-skip" />
          <Button title="Back" variant="ghost" onPress={() => navigation.goBack()} />
        </View>
      </SafeAreaView>
    );
  }

  const shown = new Map<number, string>();
  puzzle.entries.forEach((e) => {
    const cells = entryCells(puzzle, e);
    if (solved.includes(e.id)) cells.forEach((c, k) => shown.set(c, [...e.word][k]));
    else if (hinted.includes(e.id)) shown.set(cells[0], [...e.word][0]);
  });
  const numberAt = new Map(puzzle.entries.map((e) => [e.row * puzzle.cols + e.col, e.num]));
  const current = picked === null ? null : puzzle.entries[picked];
  const lit = new Set(current ? entryCells(puzzle, current) : []);

  const check = () => {
    if (!current) return;
    const right = isAnswer(current, typed);
    playFeedback(right);
    if (!right) { setNote('Not quite. Try again, or tap Hint.'); return; }
    const next = [...solved, current.id];
    setSolved(next); setTyped(''); setNote(null); setPicked(null);
    speakIn(current.word.toLocaleLowerCase(), code, { messageId: 'crossword' });
    if (next.length === puzzle.entries.length) finish(next.length);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={20} color={colors.text} /></TouchableOpacity>
        <Text style={styles.title}>Crossword</Text>
        <Text style={styles.meta}>{solved.length} of {puzzle.entries.length}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.meta}>The clues are in English. Write the answers in {langName}. This square is optional.</Text>
        <View style={{ width: cell * puzzle.cols, height: cell * puzzle.rows }} testID="crossword-grid">
          {puzzle.cells.map((ch, i) => (ch === null ? null : (
            <View key={i} style={[styles.cell, { width: cell, height: cell, left: (i % puzzle.cols) * cell, top: Math.floor(i / puzzle.cols) * cell }, lit.has(i) && styles.cellLit, shown.has(i) && styles.cellSolved]}>
              {numberAt.has(i) && <Text style={styles.num}>{numberAt.get(i)}</Text>}
              <Text style={styles.letter}>{shown.get(i) ?? ''}</Text>
            </View>
          )))}
        </View>
        <View style={styles.clues}>
          {puzzle.entries.map((e) => {
            const done = solved.includes(e.id);
            return (
              <TouchableOpacity key={e.id} disabled={done || finished} onPress={() => { setPicked(e.id); setTyped(''); setNote(null); }}
                style={[styles.clue, picked === e.id && styles.clueOn]} testID={`clue-${e.num}-${e.across ? 'across' : 'down'}`}
                accessibilityLabel={`${e.num} ${e.across ? 'across' : 'down'}: ${e.en}, ${[...e.word].length} letters${done ? ', solved' : ''}`}>
                <Text style={done ? styles.clueDone : styles.clueText}>
                  {e.num} {e.across ? 'across' : 'down'}: {e.en} ({[...e.word].length}){done ? ` = ${e.word.toLocaleLowerCase()}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {current && !finished && (
          <View style={styles.answer}>
            <TextInput value={typed} onChangeText={setTyped} onSubmitEditing={check} autoCapitalize="none" autoCorrect={false} autoFocus
              placeholder={`${current.num} ${current.across ? 'across' : 'down'} in ${langName}`} placeholderTextColor={colors.textMuted} style={styles.typed} testID="crossword-typed" />
            {!!note && <Text style={styles.meta}>{note}</Text>}
            <View style={styles.row}>
              <Button title="Check" onPress={check} testID="crossword-check" />
              <Button title="Hint" variant="outline" onPress={() => setHinted((h) => [...h, current.id])} testID="crossword-hint" />
            </View>
          </View>
        )}
        {finished
          ? <Button title="Back to the board" onPress={() => navigation.goBack()} testID="crossword-done" />
          : <Button title="Skip this square" variant="ghost" onPress={skip} testID="crossword-skip" />}
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
  meta: { ...TYPOGRAPHY.meta, color: colors.textMuted, textAlign: 'center' as const },
  cell: { position: 'absolute' as const, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cellLit: { backgroundColor: `${colors.primary}44` },
  cellSolved: { backgroundColor: `${colors.success}55` },
  num: { ...TYPOGRAPHY.meta, position: 'absolute' as const, top: 0, left: 2, fontSize: 9, color: colors.textMuted },
  letter: { ...TYPOGRAPHY.body, color: colors.text },
  clues: { alignSelf: 'stretch' as const, gap: SPACING.xs },
  clue: { padding: SPACING.sm, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  clueOn: { borderColor: colors.primary },
  clueText: { ...TYPOGRAPHY.bodySmall, color: colors.text },
  clueDone: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, textDecorationLine: 'line-through' as const },
  answer: { alignSelf: 'stretch' as const, gap: SPACING.sm },
  typed: { ...TYPOGRAPHY.h3, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: SPACING.md },
  row: { flexDirection: 'row' as const, gap: SPACING.sm },
});

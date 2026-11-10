import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useTheme } from '../theme';
import type { StudyResult, Source } from '../study/engine';
import { matchWordSearch, normalizeLearningWord } from '../study/learningGames';
const OPACITY_0_5 = 0.5;
const OPACITY_1 = 1;
const COLOR_FFF = '#fff';
const BORDERWIDTH_0_5 = 0.5;
const BORDERWIDTH_0 = 0;
const BACKGROUNDCOLOR_22C55E44 = '#22C55E44';
const literalStyles = StyleSheet.create({
  s1: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 6 },
  s2: { fontSize: 12 },
  s3: { marginVertical: 8 },
  s4: { padding: 11, borderRadius: 8, marginVertical: 6 },
  s5: { color: COLOR_FFF, textAlign: 'center', fontWeight: '700' },
  s6: { flexDirection: 'row', flexWrap: 'wrap' },
  s7: { alignSelf: 'center' },
  s8: { justifyContent: 'center', alignItems: 'center' },
  s9: { fontWeight: '700' },
  s10: { position: 'absolute', top: 0, left: 1, fontSize: 7 },
  s11: { padding: 10, marginVertical: 3 },
  s12: { borderRadius: 7 },
  s13: { fontWeight: '600' },
  s14: { marginTop: 12 },
  s15: { borderRadius: 8, padding: 12 },
  s16: { alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
  s17: { paddingVertical: 5 },
  s18: { marginBottom: 12 },
  s19: { fontSize: 19, fontWeight: '700', marginBottom: 10 },
  s20: { padding: 13, marginVertical: 5, borderRadius: 9 },
  s21: { borderWidth: 1 },
  s22: { fontSize: 20 },
});


type Props = { activity: StudyResult; onOpenSource: (source: Source) => void };

export function ProjectLearningGame({ activity, onOpenSource }: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [solved, setSolved] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [entryText, setEntryText] = useState('');
  const [firstCell, setFirstCell] = useState<number | null>(null);
  const [notice, setNotice] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const [matchingScore, setMatchingScore] = useState(0);
  const [matchingPicked, setMatchingPicked] = useState<string | null>(null);
  const terms = activity.learningTerms || [];
  const sourceLinks = (nums: number[]) => (
    <View style={literalStyles.s1}>
      {nums.map(n => {
        const source = activity.sources.find(s => s.n === n);
        return source ? <TouchableOpacity key={n} onPress={() => onOpenSource(source)}><Text style={[{ color: colors.primary }, literalStyles.s2]}>[{n}] {source.doc.slice(0, 30)}</Text></TouchableOpacity> : null;
      })}
    </View>
  );
  const banner = (message: string) => <Text style={[{ color: colors.textSecondary }, literalStyles.s3]}>{message}</Text>;
  const button = (label: string, action: () => void, disabled = false) =>
    <TouchableOpacity onPress={action} disabled={disabled} style={[literalStyles.s4, { backgroundColor: colors.primary, opacity: disabled ? OPACITY_0_5 : OPACITY_1 }]}><Text style={literalStyles.s5}>{label}</Text></TouchableOpacity>;
  const crossword = activity.crossword;
  if (activity.kind === 'crossword' && crossword) {
    const cellSize = Math.min(22, Math.max(15, Math.floor((width - 42) / crossword.size)));
    const activeEntry = crossword.entries.find(e => e.id === selected);
    const shownLetters = Array(crossword.cells.length).fill('');
    solved.forEach(id => {
      const entry = crossword.entries.find(e => e.id === id);
      if (!entry) return;
      for (let k = 0; k < entry.answer.length; k++) {
        const row = entry.row + (entry.direction === 'down' ? k : 0);
        const col = entry.col + (entry.direction === 'across' ? k : 0);
        shownLetters[row * crossword.size + col] = entry.answer[k];
      }
    });
    return <View>
      {banner('Select a clue, type the answer, then check it. Every answer comes from a source passage.')}
      <View style={[literalStyles.s6, { width: cellSize * crossword.size }, literalStyles.s7]}>
        {crossword.cells.map((char, i) => {
          const row = Math.floor(i / crossword.size), col = i % crossword.size;
          const highlighted = activeEntry && Array.from({ length: activeEntry.answer.length }, (_, k) =>
            (activeEntry.row + (activeEntry.direction === 'down' ? k : 0)) * crossword.size +
            activeEntry.col + (activeEntry.direction === 'across' ? k : 0)).includes(i);
          return <View key={i} style={[{ width: cellSize, height: cellSize, borderWidth: char ? BORDERWIDTH_0_5 : BORDERWIDTH_0, borderColor: colors.textMuted, backgroundColor: !char ? colors.background : highlighted ? `${colors.primary}44` : colors.surface }, literalStyles.s8]}>
            {!!char && <Text style={[{ color: colors.text }, literalStyles.s9, { fontSize: Math.max(10, cellSize - 6) }]}>{shownLetters[i]}</Text>}
            {!!char && !shownLetters[i] && crossword.entries.some(e => e.row === row && e.col === col) && <Text style={[literalStyles.s10, { color: colors.textMuted }]}>{crossword.entries.find(e => e.row === row && e.col === col)?.number}</Text>}
          </View>;
        })}
      </View>
      {banner(solved.length === crossword.entries.length ? 'All clues solved!' : `Solved ${solved.length} of ${crossword.entries.length} clues`)}
      {crossword.entries.map(entry => <TouchableOpacity key={entry.id} onPress={() => { setSelected(entry.id); setEntryText(''); setNotice(''); }} style={[literalStyles.s11, { backgroundColor: selected === entry.id ? `${colors.primary}22` : colors.surface }, literalStyles.s12]}>
        <Text style={[{ color: colors.text }, literalStyles.s13]}>{entry.number} {entry.direction === 'across' ? 'Across' : 'Down'} · {entry.clue} ({entry.answer.length}) {solved.includes(entry.id) ? '✓' : ''}</Text>
        {sourceLinks(entry.src)}
      </TouchableOpacity>)}
      {activeEntry && !solved.includes(activeEntry.id) && <View style={literalStyles.s14}>
        <TextInput value={entryText} onChangeText={setEntryText} autoCapitalize="characters" autoCorrect={false} maxLength={activeEntry.answer.length} placeholder="Type your answer" placeholderTextColor={colors.textMuted} style={[{ color: colors.text, backgroundColor: colors.surface }, literalStyles.s15]} />
        {button('Check answer', () => {
          if (normalizeLearningWord(entryText) === activeEntry.answer) { setSolved(ids => [...ids, activeEntry.id]); setSelected(null); setEntryText(''); setNotice('Correct!'); }
          else setNotice('Not quite. Try again.');
        })}
      </View>}
      {!!notice && banner(notice)}
    </View>;
  }
  const wordSearch = activity.wordSearch;
  if (activity.kind === 'wordsearch' && wordSearch) {
    const cellSize = Math.min(24, Math.max(17, Math.floor((width - 40) / wordSearch.size)));
    const foundIndices = new Set<number>();
    solved.forEach(id => {
      const entry = wordSearch.entries.find(e => e.id === id);
      if (!entry) return;
      for (let k = 0; k < entry.answer.length; k++) foundIndices.add((entry.row + entry.dr * k) * wordSearch.size + entry.col + entry.dc * k);
    });
    const tap = (index: number) => {
      if (firstCell === null) { setFirstCell(index); setNotice('Now tap the last letter of the word.'); return; }
      const matching = wordSearch.entries.find(e => !solved.includes(e.id) && matchWordSearch(e, firstCell, index, wordSearch.size));
      if (matching) { setSolved(ids => [...ids, matching.id]); setNotice(`Found ${matching.answer}!`); }
      else setNotice('No matching word along those cells. Try again.');
      setFirstCell(null);
    };
    return <View>
      {banner('Find words from the project passages. Tap a word’s first letter, then its last letter; either direction works.')}
      <View style={[literalStyles.s6, { width: cellSize * wordSearch.size }, literalStyles.s7]}>
        {wordSearch.cells.map((char, index) => <TouchableOpacity key={index} onPress={() => tap(index)} style={[{ width: cellSize, height: cellSize }, literalStyles.s16, { backgroundColor: foundIndices.has(index) ? BACKGROUNDCOLOR_22C55E44 : firstCell === index ? `${colors.primary}55` : colors.surface }]}>
          <Text style={[{ color: colors.text, fontSize: Math.max(11, cellSize - 7) }, literalStyles.s13]}>{char}</Text>
        </TouchableOpacity>)}
      </View>
      {banner(notice || (`Found ${solved.length} of ${wordSearch.entries.length} words`))}
      {wordSearch.entries.map(entry => <View key={entry.id} style={literalStyles.s17}>
        <Text style={{ color: colors.text }}>{solved.includes(entry.id) ? '✓ ' : '○ '}{entry.clue} ({entry.answer.length} letters)</Text>
        {solved.includes(entry.id) && <Text style={[{ color: colors.primary }, literalStyles.s13]}>{entry.answer}</Text>}
        {sourceLinks(entry.src)}
      </View>)}
    </View>;
  }
  if (activity.kind === 'match') {
    const termsWithOptions = terms.slice(0, 8);
    const current = termsWithOptions[matchIndex];
    return <View>
      {banner('Match each clue to the corresponding term from this project’s documents.')}
      <Text style={[{ color: colors.text }, literalStyles.s18]}>Correct: {matchingScore} / {termsWithOptions.length} · Round {Math.min(matchIndex + 1, termsWithOptions.length)}</Text>
      {current ? <View>
        <Text style={[{ color: colors.text }, literalStyles.s19]}>{current.clue}</Text>
        {sourceLinks(current.src)}
        {termsWithOptions.map((candidate, i) => <TouchableOpacity key={i} disabled={matchingPicked !== null} onPress={() => {
          setMatchingPicked(candidate.answer);
          if (candidate.answer === current.answer) setMatchingScore(score => score + 1);
        }} style={[literalStyles.s20, { borderColor: colors.border }, literalStyles.s21, { backgroundColor: matchingPicked === candidate.answer ? `${colors.primary}33` : colors.surface }]}>
          <Text style={{ color: colors.text }}>{candidate.answer}</Text>
        </TouchableOpacity>)}
        {matchingPicked !== null && <View>
          {banner(matchingPicked === current.answer ? 'Correct!' : `Correct answer: ${current.answer}`)}
          {button('Next clue', () => { setMatchIndex(index => index + 1); setMatchingPicked(null); })}
        </View>}
      </View> : <Text style={[{ color: colors.text }, literalStyles.s22]}>Complete! Score: {matchingScore} / {termsWithOptions.length}</Text>}
    </View>;
  }
  return banner('This learning activity is not available.');
}

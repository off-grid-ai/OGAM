/** Word games built from the project's key terms: memory pairs, hangman / term guess, fill the blanks. */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import type { LearningTerm } from '../../study/learningGames';
import {
  buildPairs, closeEnough, hangmanGuess, hangmanMask, hangmanStatus, HANGMAN_LIVES, shuffle, wordleFeedback,
  type ClozeItem, type HangmanState, type PairCard,
} from '../../study/games/logic';
import { Banner, BAD, Card, Choice, Finished, GameButton, GOOD, ScoreLine, SourceLinks, useGameColors, useRecord, type GameProps } from './kit';
const COLOR_FFF = '#fff';
const FONTSIZE_15 = 15;
const FONTSIZE_12 = 12;
const FONTWEIGHT_700 = '700';
const FONTWEIGHT_400 = '400';
const literalStyles = StyleSheet.create({
  s1: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  s2: { padding: 4 },
  s3: { minHeight: 86, borderRadius: 10, padding: 8, justifyContent: 'center', alignItems: 'center' },
  s4: { textAlign: 'center' },
  s5: { fontWeight: '700' },
  s6: { flexDirection: 'row', gap: 8 },
  s7: { padding: 8, borderRadius: 8 },
  s8: { fontSize: 17 },
  s9: { fontSize: 28, letterSpacing: 4, textAlign: 'center', marginVertical: 12, fontWeight: '700' },
  s10: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 10 },
  s11: { width: 34, height: 42, margin: 2, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  s12: { flexDirection: 'row', justifyContent: 'center', marginVertical: 2 },
  s13: { width: 32, height: 36, margin: 2, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  s14: { color: COLOR_FFF, fontWeight: '800' },
  s15: { flexDirection: 'row', gap: 8, marginTop: 8 },
  s16: { flex: 1 },
  s17: { borderRadius: 8, padding: 12, letterSpacing: 3 },
  s18: { textAlign: 'center', marginTop: 8 },
  s19: { fontWeight: '800' },
  s20: { fontWeight: '700', textAlign: 'center', marginTop: 8 },
  s21: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  s22: { fontSize: 17, lineHeight: 25 },
  s23: { borderRadius: 8, padding: 12 },
  s24: { fontWeight: '700', marginTop: 6 },
});


// ----------------------------------------------------------------- memory pairs
export function PairsGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const { width } = useWindowDimensions();
  const terms: LearningTerm[] = result.game?.data?.terms ?? [];
  const [cards, setCards] = useState<PairCard[]>(result.game?.data?.cards ?? buildPairs(terms, 6));
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [started] = useState(Date.now());
  const record = useRecord(projectId);
  const pairs = cards.length / 2;
  const cols = width >= 700 ? 4 : 3;
  const tap = (card: PairCard) => {
    if (open.length === 2 || open.includes(card.id) || matched.includes(card.pair)) return;
    const next = [...open, card.id];
    setOpen(next);
    if (next.length === 2) {
      setMoves((m) => m + 1);
      const [a, b] = next.map((id) => cards.find((c) => c.id === id)!);
      const term = terms[a.pair];
      if (a.pair === b.pair) {
        setMatched((m) => [...m, a.pair]);
        if (term) record(term.clue, term.answer, true, term.src);
        setOpen([]);
      } else setTimeout(() => setOpen([]), 1000);
    }
  };
  const done = matched.length === pairs;
  const minMoves = pairs;
  const starsEarned = moves <= minMoves * 1.5 ? 3 : moves <= minMoves * 2.2 ? 2 : 1;
  return (
    <View>
      <Banner>Flip two cards. Match each term with its clue from your documents.</Banner>
      <ScoreLine score={matched.length} max={pairs} extra={`${moves} moves`} />
      <View style={literalStyles.s1}>
        {cards.map((c) => {
          const shown = open.includes(c.id) || matched.includes(c.pair);
          return (
            <View key={c.id} style={[{ width: `${100 / cols}%` }, literalStyles.s2]}>
              <TouchableOpacity onPress={() => tap(c)} accessibilityLabel={shown ? c.text : 'Hidden card'} accessibilityRole="button"
                style={[literalStyles.s3, { backgroundColor: matched.includes(c.pair) ? `${GOOD}33` : shown ? colors.surface : colors.primary }]}>
                <Text style={[{ color: shown ? colors.text : COLOR_FFF, fontSize: c.kind === 'term' ? FONTSIZE_15 : FONTSIZE_12, fontWeight: c.kind === 'term' ? FONTWEIGHT_700 : FONTWEIGHT_400 }, literalStyles.s4]}>
                  {shown ? c.text : '?'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
      {done && (
        <View>
          <Finished score={pairs} max={pairs} note={`${moves} moves, ${Math.round((Date.now() - started) / 1000)} s, ${'★'.repeat(starsEarned)}`}
            onAgain={() => { setCards(shuffle(cards)); setOpen([]); setMatched([]); setMoves(0); }} />
          {terms.slice(0, pairs).map((t) => (
            <Card key={t.answer}><Text style={[{ color: colors.text }, literalStyles.s5]}>{t.answer}</Text><Text style={{ color: colors.textSecondary }}>{t.clue}</Text><SourceLinks nums={t.src} result={result} onOpenSource={onOpenSource} /></Card>
          ))}
        </View>
      )}
    </View>
  );
}

// ----------------------------------------------------------------- hangman / term guess
const KEYS = 'QWERTYUIOPASDFGHJKLZXCVBNM'.split('');
export function HangmanGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const terms: LearningTerm[] = result.game?.data?.terms ?? [];
  const [mode, setMode] = useState<'hangman' | 'guess'>('hangman');
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<HangmanState>({ answer: terms[0]?.answer ?? '', guessed: [], lives: HANGMAN_LIVES });
  const [score, setScore] = useState(0);
  const [guesses, setGuesses] = useState<{ word: string; fb: string }[]>([]);
  const [typed, setTyped] = useState('');
  const record = useRecord(projectId);
  const term = terms[index];
  useEffect(() => { setState({ answer: term?.answer ?? '', guessed: [], lives: HANGMAN_LIVES }); setGuesses([]); setTyped(''); }, [index, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!term) return <Finished score={score} max={terms.length} onAgain={() => { setIndex(0); setScore(0); }} />;
  const status = mode === 'hangman' ? hangmanStatus(state)
    : guesses.some((g) => g.word === term.answer) ? 'won' : guesses.length >= 6 ? 'lost' : 'playing';
  const finish = (won: boolean) => { if (won) setScore((s) => s + 1); record(term.clue, term.answer, won, term.src); };
  const next = () => setIndex((i) => i + 1);
  const pressLetter = (l: string) => {
    const nextState = hangmanGuess(state, l);
    setState(nextState);
    const st = hangmanStatus(nextState);
    if (st !== 'playing' && hangmanStatus(state) === 'playing') finish(st === 'won');
  };
  const submitGuess = () => {
    const w = typed.toUpperCase().replace(/[^A-Z]/g, '');
    if (w.length !== term.answer.length) return;
    const list = [...guesses, { word: w, fb: wordleFeedback(w, term.answer) }];
    setGuesses(list); setTyped('');
    if (w === term.answer) finish(true); else if (list.length >= 6) finish(false);
  };
  return (
    <View>
      <View style={literalStyles.s6}>
        {(['hangman', 'guess'] as const).map((m) => (
          <TouchableOpacity key={m} onPress={() => setMode(m)} accessibilityRole="button" style={[literalStyles.s7, { backgroundColor: mode === m ? colors.primary : colors.surface }]}>
            <Text style={{ color: mode === m ? COLOR_FFF : colors.text }}>{m === 'hangman' ? 'Hangman' : 'Term guess'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScoreLine score={score} max={terms.length} extra={`term ${index + 1} of ${terms.length}`} />
      <Card><Text style={{ color: colors.textSecondary }}>Clue</Text><Text style={[{ color: colors.text }, literalStyles.s8]}>{term.clue}</Text><SourceLinks nums={term.src} result={result} onOpenSource={onOpenSource} /></Card>
      {mode === 'hangman' ? (
        <View>
          <Text style={[{ color: colors.text }, literalStyles.s9]}>{status === 'lost' ? [...term.answer].join(' ') : hangmanMask(state)}</Text>
          <Text style={[{ color: colors.textSecondary }, literalStyles.s4]}>{'♥'.repeat(Math.max(0, state.lives))}{'♡'.repeat(HANGMAN_LIVES - Math.max(0, state.lives))}</Text>
          <View style={literalStyles.s10}>
            {KEYS.map((l) => {
              const used = state.guessed.includes(l);
              return (
                <TouchableOpacity key={l} disabled={used || status !== 'playing'} onPress={() => pressLetter(l)} accessibilityLabel={`Letter ${l}`}
                  style={[literalStyles.s11, { backgroundColor: used ? (term.answer.includes(l) ? `${GOOD}55` : `${BAD}44`) : colors.surface }]}>
                  <Text style={[{ color: colors.text }, literalStyles.s5]}>{l}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ) : (
        <View>
          <Banner>{term.answer.length} letters, 6 tries. Green: right place. Yellow: in the word. Grey: not in it.</Banner>
          {guesses.map((g, i) => (
            <View key={i} style={literalStyles.s12}>
              {[...g.word].map((c, k) => (
                <View key={k} style={[literalStyles.s13, { backgroundColor: g.fb[k] === 'g' ? GOOD : g.fb[k] === 'y' ? '#CA8A04' : '#6B7280' }]}>
                  <Text style={literalStyles.s14}>{c}</Text>
                </View>
              ))}
            </View>
          ))}
          {status === 'playing' && (
            <View style={literalStyles.s15}>
              <TextInput value={typed} onChangeText={(v) => setTyped(v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, term.answer.length))} autoCapitalize="characters" autoCorrect={false}
                placeholder={'_'.repeat(term.answer.length)} placeholderTextColor={colors.textMuted} style={[literalStyles.s16, { color: colors.text, backgroundColor: colors.surface }, literalStyles.s17]} />
              <GameButton label="Guess" onPress={submitGuess} disabled={typed.length !== term.answer.length} />
            </View>
          )}
          {status === 'lost' && <Text style={[{ color: colors.text }, literalStyles.s18]}>It was <Text style={literalStyles.s19}>{term.answer}</Text></Text>}
        </View>
      )}
      {status !== 'playing' && (
        <View>
          <Text style={[{ color: status === 'won' ? GOOD : BAD }, literalStyles.s20]}>{status === 'won' ? 'Correct!' : `The answer: ${term.answer}`}</Text>
          <GameButton label={index + 1 < terms.length ? 'Next term' : 'See score'} onPress={next} />
        </View>
      )}
    </View>
  );
}

// ----------------------------------------------------------------- fill the blanks
export function ClozeGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const items: ClozeItem[] = useMemo(() => result.game?.data?.items ?? [], [result]);
  const [round, setRound] = useState<ClozeItem[]>(items);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [hard, setHard] = useState(false);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [missed, setMissed] = useState<ClozeItem[]>([]);
  const record = useRecord(projectId);
  const item = round[i];
  if (!item) {
    if (missed.length) {
      return (
        <View>
          <Banner>Round done. {missed.length} to retry.</Banner>
          <GameButton label="Retry the missed ones" onPress={() => { setRound(missed); setMissed([]); setI(0); setPicked(null); }} />
          <Finished score={score} max={items.length} />
        </View>
      );
    }
    return <Finished score={score} max={items.length} onAgain={() => { setRound(shuffle(items)); setI(0); setScore(0); setPicked(null); }} />;
  }
  const answer = (value: string) => {
    if (picked !== null) return;
    const ok = hard ? closeEnough(value, item.answer) : value === item.answer;
    setPicked(value);
    record(item.sentence, item.answer, ok, item.src);
    if (ok) { setScore((s) => s + (streak >= 2 ? 2 : 1)); setStreak((s) => s + 1); }
    else { setStreak(0); setMissed((m) => [...m, item]); }
  };
  const ok = picked !== null && (hard ? closeEnough(picked, item.answer) : picked === item.answer);
  return (
    <View>
      <View style={literalStyles.s21}>
        <ScoreLine score={score} max={items.length} extra={streak >= 2 ? `streak x${streak}` : undefined} />
        <TouchableOpacity onPress={() => setHard((h) => !h)} accessibilityRole="switch" accessibilityState={{ checked: hard }}><Text style={{ color: colors.primary }}>{hard ? 'Hard: typing' : 'Easy: word bank'}</Text></TouchableOpacity>
      </View>
      <Card><Text style={[{ color: colors.text }, literalStyles.s22]}>{item.sentence}</Text><SourceLinks nums={item.src} result={result} onOpenSource={onOpenSource} /></Card>
      {hard ? (
        <View>
          <TextInput value={typed} onChangeText={setTyped} editable={picked === null} autoCapitalize="characters" placeholder="Type the missing word" placeholderTextColor={colors.textMuted} style={[{ color: colors.text, backgroundColor: colors.surface }, literalStyles.s23]} />
          <GameButton label="Check" onPress={() => answer(typed)} disabled={!typed.trim() || picked !== null} />
        </View>
      ) : item.options.map((o) => (
        <Choice key={o} label={o} onPress={() => answer(o)} disabled={picked !== null}
          state={picked === null ? null : o === item.answer ? 'right' : o === picked ? 'wrong' : null} />
      ))}
      {picked !== null && (
        <View>
          <Text style={[{ color: ok ? GOOD : BAD }, literalStyles.s24]}>{ok ? 'Correct!' : `Answer: ${item.answer}`}</Text>
          <GameButton label="Next" onPress={() => { setI((x) => x + 1); setPicked(null); setTyped(''); }} />
        </View>
      )}
    </View>
  );
}

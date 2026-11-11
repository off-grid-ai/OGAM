/** Word scramble, prize ladder and fix-the-mistake, from the project's own documents. */
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { LearningTerm } from '../../study/learningGames';
import type { McQuestion } from '../../study/games/generate';
import {
  fiftyFifty, ladderFallback, LADDER_PRIZES, LADDER_SAFE, scramblePoints, scrambleWord, shuffle, type FixItem,
} from '../../study/games/logic';
import { McView } from './BoardGames';
import { Banner, BAD, Card, Choice, Finished, GameButton, GOOD, ScoreLine, SourceLinks, Title, useGameColors, useRecord, type GameProps } from './kit';
const literalStyles = StyleSheet.create({
  s1: { fontSize: 17 },
  s2: { fontSize: 30, letterSpacing: 6, textAlign: 'center', marginVertical: 14, fontWeight: '700' },
  s3: { textAlign: 'center' },
  s4: { borderRadius: 10, padding: 12, fontSize: 18, textAlign: 'center' },
  s5: { flexDirection: 'row', gap: 8 },
  s6: { flex: 1 },
  s7: { fontWeight: '700' },
  s8: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  s9: { marginTop: 4 },
  s10: { marginBottom: 6 },
  s11: { fontSize: 17, fontWeight: '600', marginBottom: 6 },
  s12: { flexDirection: 'row', gap: 6 },
  s13: { fontSize: 12 },
});


// ----------------------------------------------------------------- word scramble
export function ScrambleGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const terms: LearningTerm[] = useMemo(() => result.game?.data?.terms ?? [], [result]);
  const [order, setOrder] = useState(() => shuffle(terms.map((_, i) => i), result.createdAt));
  const [pos, setPos] = useState(0);
  const [typed, setTyped] = useState('');
  const [hint, setHint] = useState(false);
  const [state, setState] = useState<'playing' | 'right' | 'wrong'>('playing');
  const [score, setScore] = useState(0);
  const record = useRecord(projectId);
  const term = terms[order[pos]];
  if (!term) return <Finished score={score} max={terms.length * 2} onAgain={() => { setOrder(shuffle(order)); setPos(0); setScore(0); setState('playing'); setHint(false); setTyped(''); }} />;
  const letters = scrambleWord(term.answer, result.createdAt + pos * 17);
  const next = () => { setPos((p) => p + 1); setTyped(''); setHint(false); setState('playing'); };
  const submit = () => {
    const guess = typed.toUpperCase().replace(/[^A-Z]/g, '');
    if (!guess) return;
    const ok = guess === term.answer.toUpperCase();
    record({ prompt: term.clue, answer: term.answer, src: term.src }, ok);
    if (ok) { setScore((s) => s + scramblePoints(hint)); setState('right'); } else setState('wrong');
  };
  return (
    <View>
      <Banner>Put the letters in order to spell the term that fits the clue. The first-letter hint costs a point.</Banner>
      <ScoreLine score={score} max={terms.length * 2} extra={`word ${pos + 1} of ${terms.length}`} />
      <Card><Text style={{ color: colors.textSecondary }}>Clue</Text><Text style={[{ color: colors.text }, literalStyles.s1]}>{term.clue}</Text></Card>
      <Text accessibilityLabel={`Scrambled letters: ${[...letters].join(' ')}`} style={[{ color: colors.text }, literalStyles.s2]}>{letters}</Text>
      {hint && state === 'playing' && <Text style={[{ color: colors.textSecondary }, literalStyles.s3]}>Starts with {term.answer[0].toUpperCase()}, {term.answer.length} letters</Text>}
      {state === 'playing' ? (
        <View>
          <TextInput value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} placeholder="Your answer" placeholderTextColor={colors.textMuted}
            onSubmitEditing={submit} accessibilityLabel="Your answer"
            style={[{ backgroundColor: colors.surface, color: colors.text }, literalStyles.s4]} />
          <GameButton label="Check" onPress={submit} />
          <View style={literalStyles.s5}>
            <View style={literalStyles.s6}><GameButton kind="plain" label="Hint" disabled={hint} onPress={() => setHint(true)} /></View>
            <View style={literalStyles.s6}><GameButton kind="plain" label="Skip" onPress={() => { record({ prompt: term.clue, answer: term.answer, src: term.src }, false); next(); }} /></View>
          </View>
        </View>
      ) : (
        <View>
          <Card highlight={state === 'right' ? GOOD : BAD}>
            <Text style={[{ color: colors.text }, literalStyles.s7]}>{state === 'right' ? 'Right.' : `Not quite. It is ${term.answer}.`}</Text>
            <SourceLinks nums={term.src} result={result} onOpenSource={onOpenSource} />
          </Card>
          <GameButton label={pos + 1 >= terms.length ? 'See score' : 'Next word'} onPress={next} />
        </View>
      )}
    </View>
  );
}

// ----------------------------------------------------------------- prize ladder
const money = (n: number) => `$${n.toLocaleString('en-US')}`;
export function LadderGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const first: McQuestion[] = useMemo(() => result.game?.data?.questions ?? [], [result]);
  const spares: McQuestion[] = useMemo(() => result.game?.data?.spares ?? [], [result]);
  const [rung, setRung] = useState(0);
  const [questions, setQuestions] = useState(first);
  const [spare, setSpare] = useState(0);
  const [hidden, setHidden] = useState<number[]>([]);
  const [lifelines, setLifelines] = useState({ fifty: true, skip: spares.length > 0, source: true });
  const [peek, setPeek] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [end, setEnd] = useState<null | { prize: number; why: 'won' | 'wrong' | 'walked' }>(null);
  const record = useRecord(projectId);
  const q = questions[rung];
  if (end) {
    return (
      <View>
        <Title>{end.why === 'won' ? 'You reached the top.' : end.why === 'walked' ? 'You walked away.' : 'Wrong answer.'}</Title>
        <Card><Text style={[{ color: colors.text }, literalStyles.s8]}>You take home {money(end.prize)}</Text></Card>
        {end.why === 'wrong' && q && <Card highlight={BAD}><Text style={{ color: colors.text }}>Right answer: {q.options[q.answer]}</Text>{!!q.why && <Text style={[{ color: colors.textSecondary }, literalStyles.s9]}>{q.why}</Text>}<SourceLinks nums={q.src} result={result} onOpenSource={onOpenSource} /></Card>}
        <GameButton label="Play again" onPress={() => { setRung(0); setQuestions(first); setSpare(0); setHidden([]); setLifelines({ fifty: true, skip: spares.length > 0, source: true }); setPeek(false); setPicked(null); setEnd(null); }} />
      </View>
    );
  }
  if (!q) return <Text style={{ color: colors.textSecondary }}>This ladder has no questions.</Text>;
  const answered = picked !== null;
  const choose = (k: number) => {
    if (answered) return;
    setPicked(k);
    const ok = k === q.answer;
    record({ prompt: q.q, answer: q.options[q.answer], src: q.src }, ok);
  };
  const advance = () => {
    const ok = picked === q.answer;
    if (!ok) { setEnd({ prize: ladderFallback(rung), why: 'wrong' }); return; }
    if (rung + 1 >= questions.length) { setEnd({ prize: LADDER_PRIZES[Math.min(rung, LADDER_PRIZES.length - 1)], why: 'won' }); return; }
    setRung(rung + 1); setPicked(null); setHidden([]); setPeek(false);
  };
  const prizeNow = rung > 0 ? LADDER_PRIZES[rung - 1] : 0;
  return (
    <View>
      <Banner>Answer to climb. A wrong answer drops you to the last safe spot (the 5th and last rungs). Walk away to keep what you have.</Banner>
      <Text style={[{ color: colors.text }, literalStyles.s7]}>Question {rung + 1} of {questions.length} for {money(LADDER_PRIZES[rung])}{LADDER_SAFE.includes(rung) ? " (clear it and the prize is safe)" : ""}</Text>
      <Text style={[{ color: colors.textMuted }, literalStyles.s10]}>Banked now: {money(prizeNow)}</Text>
      <Card>
        <Text style={[{ color: colors.text }, literalStyles.s11]}>{q.q}</Text>
        {q.options.map((o, k) => hidden.includes(k) ? null : (
          <Choice key={k} label={o} disabled={answered} onPress={() => choose(k)}
            state={!answered ? null : k === q.answer ? 'right' : k === picked ? 'wrong' : null} />
        ))}
        {peek && !answered && <SourceLinks nums={q.src} result={result} onOpenSource={onOpenSource} />}
        {answered && <View>{!!q.why && <Text style={[{ color: colors.textSecondary }, literalStyles.s9]}>{q.why}</Text>}<SourceLinks nums={q.src} result={result} onOpenSource={onOpenSource} /></View>}
      </Card>
      {answered ? (
        <GameButton label={picked === q.answer ? (rung + 1 >= questions.length ? 'Claim the top prize' : 'Next rung') : 'Continue'} onPress={advance} />
      ) : (
        <View>
          <View style={literalStyles.s12}>
            <View style={literalStyles.s6}><GameButton kind="plain" label="50:50" disabled={!lifelines.fifty} onPress={() => { setHidden(fiftyFifty(q.options.length, q.answer, result.createdAt + rung)); setLifelines((l) => ({ ...l, fifty: false })); }} /></View>
            <View style={literalStyles.s6}><GameButton kind="plain" label="Skip" disabled={!lifelines.skip || spare >= spares.length} onPress={() => { const s = spares[spare]; setQuestions((all) => all.map((x, i) => (i === rung ? s : x))); setSpare(spare + 1); setHidden([]); setLifelines((l) => ({ ...l, skip: false })); }} /></View>
            <View style={literalStyles.s6}><GameButton kind="plain" label="Source" disabled={!lifelines.source || peek} onPress={() => { setPeek(true); setLifelines((l) => ({ ...l, source: false })); }} /></View>
          </View>
          <GameButton kind="plain" label={`Walk away with ${money(prizeNow)}`} onPress={() => setEnd({ prize: prizeNow, why: 'walked' })} />
        </View>
      )}
    </View>
  );
}

// ----------------------------------------------------------------- fix the mistake
export function MistakeGame({ result, projectId, onOpenSource }: GameProps) {
  const colors = useGameColors();
  const items: FixItem[] = useMemo(() => result.game?.data?.items ?? [], [result]);
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [answered, setAnswered] = useState(false);
  const record = useRecord(projectId);
  const item = items[i];
  // McView resets when its question object changes, so the object must stay the same between renders.
  const q = useMemo<McQuestion | null>(() => (item ? { q: `This statement has a mistake:\n"${item.text}"\n\nWhich correction makes it true?`, options: item.options, answer: item.answer, why: `Correct fact: ${item.fix}`, src: item.src } : null), [item]);
  if (!item || !q) return <Finished score={score} max={items.length} onAgain={() => { setI(0); setScore(0); setAnswered(false); }} />;
  return (
    <View>
      <Banner>Each statement from your documents has one wrong fact. Pick the correction.</Banner>
      <ScoreLine score={score} max={items.length} extra={`statement ${i + 1} of ${items.length}`} />
      <Card>
        <McView q={q} result={result} onOpenSource={onOpenSource} onAnswer={(ok) => {
          setAnswered(true);
          record({ prompt: item.text, answer: item.fix, src: item.src }, ok);
          if (ok) setScore((s) => s + 1);
        }} />
      </Card>
      {answered && <GameButton label={i + 1 >= items.length ? 'See score' : 'Next statement'} onPress={() => { setAnswered(false); setI((x) => x + 1); }} />}
      <Text style={[{ color: colors.textMuted }, literalStyles.s13]}>Wrong ones come back in Review due cards.</Text>
    </View>
  );
}

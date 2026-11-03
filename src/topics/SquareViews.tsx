import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import { Button } from '../components/Button';
import { MarkdownText } from '../components/MarkdownText';
import { Choice, GOOD } from '../components/games/kit';
import { editDistance, shuffle } from '../study/games/logic';
import { gradeAnswer } from './service';
import { starsForShare, type SquareContent } from './formats';

type Of<K extends SquareContent['kind']> = Extract<SquareContent, { kind: K }>;
interface ViewProps<K extends SquareContent['kind']> { content: Of<K>; onDone: (stars: 1 | 2 | 3) => void }

function useText() {
  const { colors } = useTheme();
  return {
    colors,
    body: { color: colors.text, fontSize: 16, lineHeight: 24 },
    meta: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
    head: { color: colors.text, fontSize: 18, marginTop: 8 },
    card: { borderColor: colors.border, backgroundColor: colors.surface },
  };
}

export function LessonView({ content, onDone }: ViewProps<'lesson'>) {
  const t = useText();
  return (
    <View style={styles.gap} testID="square-lesson">
      {content.sections.map((s, i) => (
        <View key={i} style={styles.gap}>
          {!!s.heading && <Text style={t.head}>{s.heading}</Text>}
          <Text style={t.body}>{s.text}</Text>
          {!!s.example && <Text style={[styles.example, t.card, { color: t.colors.text }]}>{s.example}</Text>}
        </View>
      ))}
      {!!content.commonMistakes?.length && (
        <View style={[styles.box, t.card]} testID="lesson-mistakes">
          <Text style={t.head}>Common mistakes</Text>
          {content.commonMistakes.map((k, i) => <Text key={i} style={t.body}>{'\u2022  '}{k}</Text>)}
        </View>
      )}
      {!!content.quickCheck && <QuickCheck q={content.quickCheck.q} a={content.quickCheck.a} />}
      {!!content.keyPoints.length && (
        <View style={[styles.box, t.card]}>
          <Text style={t.head}>Key points</Text>
          {content.keyPoints.map((k, i) => <Text key={i} style={t.body}>{'•  '}{k}</Text>)}
        </View>
      )}
      <Button title="Got it" onPress={() => onDone(3)} testID="lesson-done" />
    </View>
  );
}

export function QuizView({ content, onDone }: ViewProps<'quiz'>) {
  const t = useText();
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [right, setRight] = useState(0);
  const q = content.questions[i];
  const last = i === content.questions.length - 1;
  const pick = (n: number) => { if (picked !== null) return; setPicked(n); if (n === q.answer) setRight((r) => r + 1); };
  return (
    <View style={styles.gap} testID="square-quiz">
      {!!content.passage && <View style={[styles.box, t.card]} testID="quiz-passage"><MarkdownText>{content.passage}</MarkdownText></View>}
      <Text style={t.meta}>Question {i + 1} of {content.questions.length}</Text>
      <MarkdownText>{q.q}</MarkdownText>
      {q.options.map((o, n) => (
        <Choice key={n} label={o} disabled={picked !== null} onPress={() => pick(n)}
          state={picked === null ? null : n === q.answer ? 'right' : n === picked ? 'wrong' : null} />
      ))}
      {picked !== null && (
        <>
          {!!q.why && <Text style={t.meta} testID="quiz-why">{q.why}</Text>}
          <Button title={last ? 'Finish' : 'Next'} testID="quiz-next"
            onPress={() => { if (last) onDone(starsForShare(right / content.questions.length)); else { setI(i + 1); setPicked(null); } }} />
        </>
      )}
    </View>
  );
}

export function CardsView({ content, onDone }: ViewProps<'cards'>) {
  const t = useText();
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const card = content.cards[i];
  const next = (knew: boolean) => {
    const k = known + (knew ? 1 : 0);
    if (i === content.cards.length - 1) { onDone(starsForShare(k / content.cards.length)); return; }
    setKnown(k); setI(i + 1); setFlipped(false);
  };
  return (
    <View style={styles.gap} testID="square-cards">
      <Text style={t.meta}>Card {i + 1} of {content.cards.length}</Text>
      <TouchableOpacity onPress={() => setFlipped(!flipped)} style={[styles.flash, t.card]} testID="card-flip" accessibilityLabel={flipped ? 'Show the front' : 'Show the answer'}>
        <Text style={[t.body, styles.center]}>{flipped ? card.back : card.front}</Text>
        <Text style={t.meta}>{flipped ? 'Answer' : 'Tap to see the answer'}</Text>
      </TouchableOpacity>
      {flipped && (
        <View style={styles.row}>
          <View style={styles.flex}><Button title="Again" variant="outline" onPress={() => next(false)} testID="card-again" /></View>
          <View style={styles.flex}><Button title="Knew it" onPress={() => next(true)} testID="card-knew" /></View>
        </View>
      )}
    </View>
  );
}

export function MatchView({ content, onDone }: ViewProps<'match'>) {
  const t = useText();
  const rights = useMemo(() => shuffle(content.pairs.map((_, n) => n), 7), [content]);
  const [left, setLeft] = useState<number | null>(null);
  const [done, setDone] = useState<number[]>([]);
  const [wrong, setWrong] = useState(0);
  const tapRight = (n: number) => {
    if (left === null || done.includes(n)) return;
    if (n === left) {
      const all = [...done, n];
      setDone(all); setLeft(null);
      if (all.length === content.pairs.length) onDone(starsForShare(content.pairs.length / (content.pairs.length + wrong)));
    } else { setWrong(wrong + 1); setLeft(null); }
  };
  return (
    <View style={styles.gap} testID="square-match">
      <Text style={t.meta}>Tap a term, then what goes with it.</Text>
      <View style={styles.row}>
        <View style={[styles.flex, styles.gap]}>
          {content.pairs.map((p, n) => (
            <Choice key={n} label={p.left} disabled={done.includes(n)} onPress={() => setLeft(n)}
              state={done.includes(n) ? 'right' : left === n ? 'picked' : null} />
          ))}
        </View>
        <View style={[styles.flex, styles.gap]}>
          {rights.map((n) => (
            <Choice key={n} label={content.pairs[n].right} disabled={done.includes(n)} onPress={() => tapRight(n)} state={done.includes(n) ? 'right' : null} />
          ))}
        </View>
      </View>
      <Text style={t.meta} testID="match-mistakes">{wrong ? `${wrong} not quite` : ' '}</Text>
    </View>
  );
}

export function OrderView({ content, onDone }: ViewProps<'order'>) {
  const t = useText();
  const shown = useMemo(() => shuffle(content.steps.map((_, n) => n), 11), [content]);
  const [chosen, setChosen] = useState<number[]>([]);
  const [mistakes, setMistakes] = useState(0);
  const [checked, setChecked] = useState<'right' | 'wrong' | null>(null);
  const check = () => {
    const ok = chosen.every((n, i) => n === i);
    setChecked(ok ? 'right' : 'wrong');
    if (!ok) setMistakes(mistakes + 1);
  };
  return (
    <View style={styles.gap} testID="square-order">
      <Text style={t.body}>{content.prompt}</Text>
      <Text style={t.meta}>Tap the steps in the right order.</Text>
      {chosen.map((n, i) => (
        <TouchableOpacity key={n} onPress={() => { if (checked !== 'right') { setChosen(chosen.filter((x) => x !== n)); setChecked(null); } }}
          style={[styles.step, t.card, checked === 'right' && { borderColor: GOOD }]} testID={`order-chosen-${i}`}>
          <Text style={t.body}>{i + 1}. {content.steps[n]}</Text>
        </TouchableOpacity>
      ))}
      {chosen.length < content.steps.length && shown.filter((n) => !chosen.includes(n)).map((n) => (
        <TouchableOpacity key={n} onPress={() => { setChosen([...chosen, n]); setChecked(null); }} style={[styles.step, t.card]} testID={`order-option-${n}`}>
          <Text style={t.body}>{content.steps[n]}</Text>
        </TouchableOpacity>
      ))}
      {checked === 'wrong' && <Text style={{ color: t.colors.error }} testID="order-wrong">Not the right order yet. Tap a step to take it back.</Text>}
      {checked === 'right'
        ? <Button title="Done" onPress={() => onDone(starsForShare(1 / (1 + mistakes)))} testID="order-done" />
        : <Button title="Check" disabled={chosen.length < content.steps.length} onPress={check} testID="order-check" />}
    </View>
  );
}

export function PracticeView({ content, onDone }: ViewProps<'practice'>) {
  const t = useText();
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ score: number; feedback: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [hint, setHint] = useState(false);
  const check = async () => {
    setBusy(true); setError(null);
    try { setResult(await gradeAnswer({ task: content.task, model: content.model, rubric: content.rubric, answer })); } catch (e: any) { setError(String(e?.message || e)); }
    setBusy(false);
  };
  const finished = !!result || skipped;
  return (
    <ScrollView contentContainerStyle={styles.gap} keyboardShouldPersistTaps="handled" testID="square-practice">
      <Text style={t.body}>{content.task}</Text>
      {!!content.hint && (hint ? <Text style={t.meta}>Hint: {content.hint}</Text> : <TouchableOpacity onPress={() => setHint(true)} testID="practice-hint"><Text style={{ color: t.colors.primary }}>Show a hint</Text></TouchableOpacity>)}
      <TextInput value={answer} onChangeText={setAnswer} multiline editable={!finished} placeholder="Your answer" placeholderTextColor={t.colors.textMuted}
        style={[styles.input, content.code && styles.code, { color: t.colors.text, borderColor: t.colors.border }]} testID="practice-input" autoCapitalize="none" autoCorrect={!content.code} />
      {busy && <ActivityIndicator color={t.colors.primary} />}
      {!!error && <Text style={{ color: t.colors.error }} testID="practice-error">{error}</Text>}
      {!finished && (
        <>
          <Button title="Check my answer" disabled={!answer.trim() || busy} onPress={check} testID="practice-check" />
          <TouchableOpacity onPress={() => setSkipped(true)} testID="practice-skip"><Text style={t.meta}>Show a good answer instead</Text></TouchableOpacity>
        </>
      )}
      {!!result && <View style={[styles.box, t.card]}><Text style={t.head}>{result.score}/100</Text><Text style={t.body} testID="practice-feedback">{result.feedback}</Text></View>}
      {finished && (
        <>
          <View style={[styles.box, t.card]}><Text style={t.head}>A good answer</Text><Text style={t.body}>{content.model || 'See the task above.'}</Text></View>
          <Button title="Finish" onPress={() => onDone(result ? starsForShare(result.score / 100) : 1)} testID="practice-done" />
        </>
      )}
    </ScrollView>
  );
}

/** A problem with a number for an answer: type it, see if it is within the tolerance, then read the working. */
export function NumericView({ content, onDone }: ViewProps<'numeric'>) {
  const t = useText();
  const [typed, setTyped] = useState('');
  const [tries, setTries] = useState(0);
  const [result, setResult] = useState<'right' | 'wrong' | null>(null);
  const [shown, setShown] = useState(false);
  const check = () => {
    const value = Number(typed.replace(/[,\s]/g, '').replace(/[^\d.+\-eE]/g, ''));
    const ok = Number.isFinite(value) && Math.abs(value - content.answer) <= Math.max(content.tolerance, 1e-9);
    setTries(tries + 1);
    setResult(ok ? 'right' : 'wrong');
    if (ok) setShown(true);
  };
  return (
    <ScrollView contentContainerStyle={styles.gap} keyboardShouldPersistTaps="handled" testID="square-numeric">
      <Text style={t.body}>{content.task}</Text>
      <View style={styles.row}>
        <TextInput value={typed} onChangeText={(v) => { setTyped(v); setResult(null); }} keyboardType="numbers-and-punctuation" editable={result !== 'right'} placeholder="Your answer"
          placeholderTextColor={t.colors.textMuted} style={[styles.numberInput, styles.flex, { color: t.colors.text, borderColor: t.colors.border }]} testID="numeric-input" />
        {!!content.unit && <Text style={t.body}>{content.unit}</Text>}
      </View>
      {result === 'wrong' && <Text style={{ color: t.colors.error }} testID="numeric-wrong">Not quite. Check the working and try again{tries >= 2 ? ', or look at the working below' : ''}.</Text>}
      {result === 'right' && <Text style={{ color: t.colors.primary }} testID="numeric-right">Correct: {content.answer} {content.unit}</Text>}
      {result !== 'right' && <Button title="Check" disabled={!typed.trim()} onPress={check} testID="numeric-check" />}
      {result !== 'right' && !shown && <TouchableOpacity onPress={() => setShown(true)} testID="numeric-show"><Text style={t.meta}>Show the working</Text></TouchableOpacity>}
      {shown && (
        <View style={[styles.box, t.card]} testID="numeric-working">
          <Text style={t.head}>Working</Text>
          {content.working.map((w, i) => <Text key={i} style={t.body}>{i + 1}. {w}</Text>)}
          {result !== 'right' && <Text style={t.body}>Answer: {content.answer} {content.unit}</Text>}
        </View>
      )}
      {(result === 'right' || shown) && <Button title="Finish" onPress={() => onDone(result === 'right' ? starsForShare(1 / tries) : 1)} testID="numeric-done" />}
    </ScrollView>
  );
}

/** One problem solved a step at a time, each step with its reason. */
export function WorkedView({ content, onDone }: ViewProps<'worked'>) {
  const t = useText();
  const [shown, setShown] = useState(1);
  const all = shown >= content.steps.length;
  return (
    <View style={styles.gap} testID="square-worked">
      <Text style={t.head}>{content.problem}</Text>
      {content.steps.slice(0, shown).map((x, i) => (
        <View key={i} style={[styles.box, t.card]}>
          <Text style={t.body}>{i + 1}. {x.step}</Text>
          {!!x.why && <Text style={t.meta}>Why: {x.why}</Text>}
        </View>
      ))}
      {all && !!content.takeaway && <Text style={t.body} testID="worked-takeaway">Remember: {content.takeaway}</Text>}
      {all
        ? <Button title="Got it" onPress={() => onDone(3)} testID="worked-done" />
        : <Button title="Next step" onPress={() => setShown(shown + 1)} testID="worked-next" />}
    </View>
  );
}

/** A reference table, drawn like a chat table so it can be copied the same way. */
export function TableView({ content, onDone }: ViewProps<'table'>) {
  const t = useText();
  return (
    <View style={styles.gap} testID="square-table">
      {!!content.title && <Text style={t.head}>{content.title}</Text>}
      <MarkdownText>{content.markdown}</MarkdownText>
      <Button title="Got it" onPress={() => onDone(3)} testID="table-done" />
    </View>
  );
}

/** Test yourself: think of the answer, then reveal it. */
function QuickCheck({ q, a }: { q: string; a: string }) {
  const t = useText();
  const [shown, setShown] = useState(false);
  return (
    <View style={[styles.box, t.card]} testID="lesson-quickcheck">
      <Text style={t.head}>Test yourself</Text>
      <Text style={t.body}>{q}</Text>
      {shown ? <Text style={t.body} testID="quickcheck-answer">{a}</Text>
        : <TouchableOpacity onPress={() => setShown(true)} testID="quickcheck-show"><Text style={{ color: t.colors.primary }}>Show the answer</Text></TouchableOpacity>}
    </View>
  );
}

/** Lower case, no punctuation, one space between words: how typed answers are compared. */
export const normalizeAnswer = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\u0400-\u04ff\u4e00-\u9fff\u3040-\u30ff ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** True when a typed answer is the answer (or an accepted alternative): same words, ignoring case, accents and punctuation, one slip allowed in longer answers. */
export function answersMatch(typed: string, answer: string, alternatives: string[] = []): boolean {
  const t = normalizeAnswer(typed);
  if (!t) return false;
  return [answer, ...alternatives].some((a) => {
    const n = normalizeAnswer(a);
    if (t === n) return true;
    return n.length >= 8 && Math.abs(t.length - n.length) <= 1 && editDistance(t, n) <= 1;
  });
}

/** Type the answer (or the corrected text) for each item, one at a time. */
export function TypedView({ content, onDone }: ViewProps<'typed'>) {
  const t = useText();
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState('');
  const [state, setState] = useState<'asking' | 'right' | 'wrong'>('asking');
  const [right, setRight] = useState(0);
  const item = content.items[i];
  const last = i === content.items.length - 1;
  const check = () => {
    const ok = answersMatch(typed, item.answer, item.alternatives);
    setState(ok ? 'right' : 'wrong');
    if (ok) setRight(right + 1);
  };
  const next = () => {
    if (last) { onDone(starsForShare(right / content.items.length)); return; }
    setI(i + 1); setTyped(''); setState('asking');
  };
  return (
    <View style={styles.gap} testID="square-typed">
      <Text style={t.meta}>{i + 1} of {content.items.length} · {content.mode === 'fix' ? 'Correct it' : 'Type the answer'}</Text>
      <MarkdownText>{item.prompt}</MarkdownText>
      <TextInput value={typed} onChangeText={setTyped} editable={state === 'asking'} multiline={content.mode === 'fix'} autoCapitalize="none" autoCorrect={false}
        placeholder="Your answer" placeholderTextColor={t.colors.textMuted} style={[styles.numberInput, { color: t.colors.text, borderColor: t.colors.border }]} testID="typed-input" />
      {state === 'asking' && <Button title="Check" disabled={!typed.trim()} onPress={check} testID="typed-check" />}
      {state === 'right' && <Text style={{ color: t.colors.primary }} testID="typed-right">Right.</Text>}
      {state === 'wrong' && <Text style={{ color: t.colors.error }} testID="typed-wrong">Not quite. The answer: {item.answer}</Text>}
      {state !== 'asking' && !!item.why && <Text style={t.meta}>{item.why}</Text>}
      {state !== 'asking' && <Button title={last ? 'Finish' : 'Next'} onPress={next} testID="typed-next" />}
    </View>
  );
}

/** A table with blank cells: type into each, then check them all. */
export function TableFillView({ content, onDone }: ViewProps<'tablefill'>) {
  const t = useText();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const blanks = content.rows.flatMap((r, ri) => r.map((c, ci) => (c === null ? `${ri}:${ci}` : null))).filter((x): x is string => !!x);
  const correct = (cell: string) => { const [ri, ci] = cell.split(':').map(Number); return answersMatch(typed[cell] ?? '', content.answers[ri][ci]); };
  const rightCount = blanks.filter(correct).length;
  return (
    <ScrollView contentContainerStyle={styles.gap} keyboardShouldPersistTaps="handled" testID="square-tablefill">
      {!!content.title && <Text style={t.head}>{content.title}</Text>}
      <View style={[styles.box, t.card]}>
        <View style={styles.tableRow}>{content.columns.map((c) => <Text key={c} style={[t.meta, styles.cell, styles.headCell]}>{c}</Text>)}</View>
        {content.rows.map((row, ri) => (
          <View key={ri} style={styles.tableRow}>
            {row.map((c, ci) => {
              const cell = `${ri}:${ci}`;
              if (c !== null) return <Text key={ci} style={[t.body, styles.cell]}>{c}</Text>;
              const bad = checked && !correct(cell);
              return (
                <TextInput key={ci} value={typed[cell] ?? ''} onChangeText={(v) => { setTyped({ ...typed, [cell]: v }); setChecked(false); }} autoCapitalize="none" autoCorrect={false}
                  style={[styles.cell, styles.blank, { color: t.colors.text, borderColor: bad ? t.colors.error : checked ? '#16A34A' : t.colors.border }]} testID={`tablefill-${ri}-${ci}`} />
              );
            })}
          </View>
        ))}
      </View>
      {checked && <Text style={t.body} testID="tablefill-score">{rightCount} of {blanks.length} right</Text>}
      {checked && rightCount < blanks.length && (
        <View style={[styles.box, t.card]}>
          <Text style={t.head}>The full table</Text>
          {content.answers.map((r, ri) => <Text key={ri} style={t.body}>{r.join('  |  ')}</Text>)}
          {!!content.why && <Text style={t.meta}>{content.why}</Text>}
        </View>
      )}
      {!checked
        ? <Button title="Check" onPress={() => setChecked(true)} testID="tablefill-check" />
        : <Button title="Finish" onPress={() => onDone(starsForShare(rightCount / blanks.length))} testID="tablefill-done" />}
    </ScrollView>
  );
}

/** Sort items into groups: tap an item, then its group. */
export function SortView({ content, onDone }: ViewProps<'sort'>) {
  const t = useText();
  const [placed, setPlaced] = useState<Record<number, number>>({});
  const [chosen, setChosen] = useState<number | null>(null);
  const [wrong, setWrong] = useState(0);
  const left = content.items.map((_, n) => n).filter((n) => placed[n] === undefined);
  const drop = (group: number) => {
    if (chosen === null) return;
    if (content.items[chosen].group === group) {
      const all = { ...placed, [chosen]: group };
      setPlaced(all);
      if (Object.keys(all).length === content.items.length) onDone(starsForShare(content.items.length / (content.items.length + wrong)));
    } else setWrong(wrong + 1);
    setChosen(null);
  };
  return (
    <View style={styles.gap} testID="square-sort">
      <Text style={t.meta}>Tap an item, then the group it belongs to.</Text>
      <View style={styles.chipsRow}>
        {left.map((n) => <Choice key={n} label={content.items[n].text} onPress={() => setChosen(n)} state={chosen === n ? 'picked' : null} />)}
      </View>
      {content.groups.map((g, gi) => (
        <TouchableOpacity key={g} onPress={() => drop(gi)} style={[styles.box, t.card]} testID={`sort-group-${gi}`}>
          <Text style={t.head}>{g}</Text>
          <Text style={t.meta}>{content.items.filter((_, n) => placed[n] === gi).map((x) => x.text).join(', ') || 'Tap here to put the chosen item in'}</Text>
        </TouchableOpacity>
      ))}
      <Text style={t.meta} testID="sort-mistakes">{wrong ? `${wrong} in the wrong group` : ' '}</Text>
    </View>
  );
}

/** Hear a sentence read aloud and type it. */
export function DictationView({ content, onDone }: ViewProps<'dictation'>) {
  const t = useText();
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState('');
  const [state, setState] = useState<'asking' | 'right' | 'wrong'>('asking');
  const [tries, setTries] = useState(0);
  const [right, setRight] = useState(0);
  const sentence = content.sentences[i];
  const last = i === content.sentences.length - 1;
  const play = () => { try { require('../atlasVoice/tts').speakIn(sentence, content.lang, 'dictation'); } catch { /* no voice on this phone */ } };
  React.useEffect(play, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  const check = () => {
    const ok = answersMatch(typed, sentence);
    setTries(tries + 1);
    if (ok) { setState('right'); setRight(right + (tries === 0 ? 1 : 0.5)); } else if (tries >= 1) setState('wrong'); else setTyped('');
  };
  const next = () => {
    if (last) { onDone(starsForShare(right / content.sentences.length)); return; }
    setI(i + 1); setTyped(''); setState('asking'); setTries(0);
  };
  return (
    <View style={styles.gap} testID="square-dictation">
      <Text style={t.meta}>{i + 1} of {content.sentences.length}</Text>
      <Button title="Play the sentence" variant="outline" onPress={play} testID="dictation-play" />
      <TextInput value={typed} onChangeText={setTyped} editable={state === 'asking'} multiline autoCapitalize="none" autoCorrect={false} placeholder="Type what you hear"
        placeholderTextColor={t.colors.textMuted} style={[styles.numberInput, { color: t.colors.text, borderColor: t.colors.border }]} testID="dictation-input" />
      {tries === 1 && state === 'asking' && <Text style={t.meta} testID="dictation-again">Not quite. Listen again and try once more.</Text>}
      {state === 'asking' && <Button title="Check" disabled={!typed.trim()} onPress={check} testID="dictation-check" />}
      {state === 'right' && <Text style={{ color: t.colors.primary }} testID="dictation-right">Right: {sentence}</Text>}
      {state === 'wrong' && <Text style={{ color: t.colors.error }} testID="dictation-wrong">It was: {sentence}</Text>}
      {state !== 'asking' && <Button title={last ? 'Finish' : 'Next'} onPress={next} testID="dictation-next" />}
    </View>
  );
}

export function SquareView({ content, onDone }: { content: SquareContent; onDone: (stars: 1 | 2 | 3) => void }) {
  switch (content.kind) {
    case 'lesson': return <LessonView content={content} onDone={onDone} />;
    case 'quiz': return <QuizView content={content} onDone={onDone} />;
    case 'cards': return <CardsView content={content} onDone={onDone} />;
    case 'match': return <MatchView content={content} onDone={onDone} />;
    case 'numeric': return <NumericView content={content} onDone={onDone} />;
    case 'worked': return <WorkedView content={content} onDone={onDone} />;
    case 'table': return <TableView content={content} onDone={onDone} />;
    case 'typed': return <TypedView content={content} onDone={onDone} />;
    case 'tablefill': return <TableFillView content={content} onDone={onDone} />;
    case 'sort': return <SortView content={content} onDone={onDone} />;
    case 'dictation': return <DictationView content={content} onDone={onDone} />;
    case 'order': return <OrderView content={content} onDone={onDone} />;
    default: return <PracticeView content={content} onDone={onDone} />;
  }
}

const styles = StyleSheet.create({
  gap: { gap: 10 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  flex: { flex: 1 },
  box: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  example: { borderWidth: 1, borderRadius: 8, padding: 10, fontFamily: 'monospace', fontSize: 14 },
  flash: { borderWidth: 1, borderRadius: 14, minHeight: 160, padding: 16, alignItems: 'center', justifyContent: 'center', gap: 10 },
  center: { textAlign: 'center' },
  step: { borderWidth: 1, borderRadius: 10, padding: 12 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 120, textAlignVertical: 'top' },
  code: { fontFamily: 'monospace', fontSize: 14 },
  tableRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  cell: { flex: 1, minWidth: 0, paddingVertical: 6 },
  headCell: { fontWeight: '400', textTransform: 'uppercase' },
  blank: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4 },
  chipsRow: { gap: 6 },
  numberInput: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 18 },
});

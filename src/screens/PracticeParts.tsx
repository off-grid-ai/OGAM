import React, { useEffect, useState } from 'react';
import { Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Button } from '../components/Button';
import { CitationChips } from '../components/CitationChips';
import { ACCOUNTING_DRILLS, DRILL_LABELS, STATS_DRILLS, type DrillKind } from '../study/drills';
import { answerText, type Exercise, type Verdict } from '../study/exercises';
import { secondsLeft, type Exam, type ExamResult } from '../study/exam';
import { Answer } from '../components/ExerciseAnswer';
import { good, st, type Colors } from '../components/practiceStyles';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** One drill type per button, so a single topic can be practised on its own. */
export const DrillPicker: React.FC<{ kinds: DrillKind[]; onPick: (k: DrillKind) => void; colors: Colors }> = ({ kinds, onPick, colors }) => (
  <View style={st.wrap} testID="drill-picker">
    {kinds.map((k) => (
      <TouchableOpacity key={k} testID={`drill-${k}`} onPress={() => onPick(k)} style={[st.pill, { borderColor: colors.border }]}>
        <Text style={[st.small13, { color: colors.text }]}>{DRILL_LABELS[k]}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

/** The exam: one question at a time, no feedback, a clock that ends it. */
export const ExamRunner: React.FC<{ exam: Exam; questions: Exercise[]; answers: Record<string, unknown>; onAnswer: (id: string, v: unknown) => void; onFinish: () => void; colors: Colors }> = ({ exam, questions, answers, onAnswer, onFinish, colors }) => {
  const [index, setIndex] = useState(0);
  const [left, setLeft] = useState(secondsLeft(exam, Date.now()));
  useEffect(() => {
    const t = setInterval(() => { const l = secondsLeft(exam, Date.now()); setLeft(l); if (l <= 0) { clearInterval(t); onFinish(); } }, 1000);
    return () => clearInterval(t);
  }, [exam, onFinish]);
  const q = questions[index];
  if (!q) return null;
  const last = index === questions.length - 1;
  return (
    <View>
      <Text testID="exam-clock" style={[st.small12, { color: left < 60 ? colors.error : colors.textMuted }]}>Question {index + 1} of {questions.length} - {clock(left)} left</Text>
      <Text testID="exam-prompt" style={[st.prompt, { color: colors.text }]}>{q.kind === 'testlet' ? 'Answer all parts' : q.prompt}</Text>
      <Answer ex={q} value={answers[q.id]} onChange={(v) => onAnswer(q.id, v)} colors={colors} />
      <View style={st.wrap}>
        {index > 0 && <Button title="Back" variant="ghost" onPress={() => setIndex(index - 1)} testID="exam-back" style={st.top14} />}
        <Button title={last ? 'Finish exam' : 'Next'} onPress={last ? onFinish : () => setIndex(index + 1)} testID={last ? 'exam-finish' : 'exam-next'} style={st.top14} />
      </View>
    </View>
  );
};

export const ExamResultView: React.FC<{ result: ExamResult; onReview: () => void; onDone: () => void; colors: Colors }> = ({ result, onReview, onDone, colors }) => (
  <View>
    <Text testID="exam-score" style={[st.prompt, { color: result.percent >= 70 ? good : colors.error }]}>{result.correct} of {result.total} correct ({result.percent}%)</Text>
    {result.unanswered > 0 && <Text style={{ color: colors.textSecondary }}>{result.unanswered} left blank (counted as wrong).</Text>}
    <Text style={[st.semi, st.top14, { color: colors.text }]}>By topic (weakest first)</Text>
    {result.byTopic.map((t) => <Text key={t.topic} style={{ color: colors.textSecondary }}>{t.topic}: {t.correct} of {t.total}</Text>)}
    {result.wrong.length > 0 && <Button title={`Review the ${result.wrong.length} I missed`} onPress={onReview} testID="exam-review" style={st.top14} />}
    <Button title="Done" variant="ghost" onPress={onDone} testID="exam-done" style={st.top6} />
  </View>
);

/** Missed questions as flashcards: tap to see the answer, then "Got it" removes it for now and "Again" puts it at the back. */
export const Flashcards: React.FC<{ cards: Exercise[]; onGotIt: (id: string) => void; onAgain: (id: string) => void; onStop: () => void; colors: Colors }> = ({ cards, onGotIt, onAgain, onStop, colors }) => {
  const [flipped, setFlipped] = useState(false);
  const card = cards[0];
  if (!card) return <View><Text testID="cards-empty" style={{ color: colors.textSecondary }}>No cards left. Nice.</Text><Button title="Done" variant="ghost" onPress={onStop} style={st.top10} /></View>;
  const step = (fn: (id: string) => void) => () => { setFlipped(false); fn(card.id); };
  return (
    <View>
      <Text style={[st.small12, { color: colors.textMuted }]}>{cards.length} card{cards.length === 1 ? '' : 's'} left{card.topic ? ` - ${card.topic}` : ''}</Text>
      <TouchableOpacity testID="card" onPress={() => setFlipped(!flipped)} style={[st.choice, { borderColor: colors.border }]}>
        <Text style={{ color: colors.text }}>{card.kind === 'testlet' ? card.stem : card.prompt}</Text>
        {flipped && <Text testID="card-answer" style={[st.top10, { color: good }]}>{answerText(card)}</Text>}
        {!flipped && <Text style={[st.small12, st.top10, { color: colors.textMuted }]}>Tap to see the answer</Text>}
      </TouchableOpacity>
      {flipped && <View style={st.wrap}>
        <Button title="Got it" onPress={step(onGotIt)} testID="card-got" style={st.top14} />
        <Button title="Again" variant="outline" onPress={step(onAgain)} testID="card-again" style={st.top14} />
      </View>}
      <Button title="Stop" variant="ghost" onPress={onStop} style={st.top6} />
    </View>
  );
};

/** A note on why a question was missed; kept with the question and shown when it comes back. */
export const WhyWrong: React.FC<{ value?: string; onChange: (t: string) => void; colors: Colors }> = ({ value, onChange, colors }) => (
  <TextInput testID="why-wrong" value={value ?? ''} onChangeText={onChange} placeholder="Why did I get this wrong? (a note for next time)" placeholderTextColor={colors.textMuted} multiline style={[st.input, st.top10, { borderColor: colors.border, color: colors.text, minHeight: 50 }]} />
);

export interface HomeProps {
  topic: string; setTopic: (t: string) => void; busy: boolean; note: string; pickDrill: boolean; setPickDrill: (b: boolean) => void;
  goalOn: boolean; goalLine: string | null; perDay: number; setGoalOn: (on: boolean) => void;
  scores: Array<{ topic: string; attempts: number; percent: number }>;
  onMake: () => void; onDrills: (kinds: DrillKind[]) => void; onStart: (topic?: string) => void; onExam: () => void; onCards: () => void; onClear: () => void;
  colors: Colors;
}

/** The start page: ways to begin practising. */
export const PracticeHome: React.FC<HomeProps> = (p) => (
  <View>
    {p.goalLine && <Text testID="goal-line" style={{ color: p.colors.textSecondary }}>{p.goalLine}</Text>}
    <TextInput testID="practice-topic" value={p.topic} onChangeText={p.setTopic} placeholder="Topic or chapter (optional)" placeholderTextColor={p.colors.textMuted} style={[st.input, st.top8, { borderColor: p.colors.border, color: p.colors.text }]} />
    <Button title={p.busy ? 'Writing questions...' : 'Make questions from my documents'} onPress={p.onMake} loading={p.busy} disabled={p.busy} testID="practice-make" style={st.top10} />
    <Button title="Accounting drills (balance sheet, interest, loans, statements...)" variant="outline" onPress={() => p.onDrills(ACCOUNTING_DRILLS)} testID="practice-drills" style={st.top8} />
    <Button title="Research statistics drills (doctoral courses)" variant="outline" onPress={() => p.onDrills(STATS_DRILLS)} testID="practice-stats-drills" style={st.top8} />
    <Button title={p.pickDrill ? 'Hide drill types' : 'Pick one drill type'} variant="ghost" onPress={() => p.setPickDrill(!p.pickDrill)} testID="practice-pick-drill" style={st.top6} />
    {p.pickDrill && <DrillPicker kinds={[...ACCOUNTING_DRILLS, ...STATS_DRILLS]} onPick={(k) => p.onDrills([k])} colors={p.colors} />}
    <Button title="Practise what I have (missed and due first)" variant="outline" onPress={() => p.onStart(p.topic.trim() || undefined)} testID="practice-start" style={st.top8} />
    <Button title="Timed exam (20 questions, 30 minutes)" variant="outline" onPress={p.onExam} testID="practice-exam" style={st.top8} />
    <Button title="Flashcards from my misses" variant="outline" onPress={p.onCards} testID="practice-cards" style={st.top8} />
    {!!p.note && <Text testID="practice-note" style={[st.top10, { color: p.colors.textSecondary }]}>{p.note}</Text>}
    <View style={[st.wrap, st.top14]}>
      <Switch value={p.goalOn} onValueChange={p.setGoalOn} testID="goal-switch" />
      <Text style={[st.gap, { color: p.colors.textSecondary }]}>Daily goal and streak ({p.perDay} questions a day)</Text>
    </View>
    {p.scores.length > 0 && (
      <View style={st.top18}>
        <Text style={[st.semi, { color: p.colors.text }]}>Score by topic (weakest first)</Text>
        {p.scores.map((s) => (
          <TouchableOpacity key={s.topic} onPress={() => p.onStart(s.topic)} style={st.pad8}>
            <Text style={{ color: s.percent < 60 ? p.colors.error : p.colors.text }}>{s.topic}: {s.percent}% ({s.attempts} tries)</Text>
          </TouchableOpacity>
        ))}
        <Button title="Clear my practice history" variant="ghost" onPress={p.onClear} testID="practice-clear" style={st.top6} />
      </View>
    )}
  </View>
);

export interface RunProps {
  current: Exercise; left: number; value: unknown; earlierNote?: string; verdict?: Verdict; note?: string;
  onDraft: (v: unknown) => void; onCheck: () => void; onNext: () => void; onStop: () => void; onNote: (t: string) => void; colors: Colors;
}

/** One question: the answer widget, the verdict with its source, and a note box after a miss. */
export const PracticeRun: React.FC<RunProps> = (p) => (
  <View>
    <Text style={[st.small12, { color: p.colors.textMuted }]}>{p.left} left{p.current.topic ? ` - ${p.current.topic}` : ''}</Text>
    <Text testID="practice-prompt" style={[st.prompt, { color: p.colors.text }]}>{p.current.kind === 'testlet' ? 'Answer all parts' : p.current.prompt}</Text>
    {!!p.earlierNote && !p.verdict && <Text testID="earlier-note" style={[st.top8, { color: p.colors.textSecondary }]}>Your note from last time: {p.earlierNote}</Text>}
    <Answer ex={p.current} value={p.value} onChange={p.onDraft} verdict={p.verdict} colors={p.colors} />
    {p.verdict && (
      <View style={st.top14}>
        <Text testID="practice-result" style={[st.semi, { color: p.verdict.correct ? good : p.colors.error }]}>{p.verdict.correct ? 'Correct' : 'Not quite'}{p.verdict.note ? ` - ${p.verdict.note}` : ''}</Text>
        {!!p.current.explain && <Text style={[st.top4, { color: p.colors.textSecondary }]}>{p.current.explain}</Text>}
        {p.current.source && <CitationChips cites={[{ title: p.current.source.doc, page: p.current.source.page, section: p.current.source.section, quote: p.current.source.quote, verified: true }]} />}
        {!p.verdict.correct && <WhyWrong value={p.note} onChange={p.onNote} colors={p.colors} />}
      </View>
    )}
    <Button title={p.verdict ? 'Next' : 'Check'} onPress={p.verdict ? p.onNext : p.onCheck} testID={p.verdict ? 'practice-next' : 'practice-check'} style={st.top14} />
    <Button title="Stop" variant="ghost" onPress={p.onStop} style={st.top6} />
  </View>
);

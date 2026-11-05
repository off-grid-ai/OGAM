import React, { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Button } from '../components/Button';
import { DRILL_LABELS, type DrillKind } from '../study/drills';
import { answerText, type Exercise } from '../study/exercises';
import { secondsLeft, type Exam, type ExamResult } from '../study/exam';
import { Answer, good, st, type Colors } from '../components/ExerciseAnswer';

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

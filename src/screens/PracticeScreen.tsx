import React, { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Alert, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { Button } from '../components/Button';
import { Answer, good, st } from '../components/ExerciseAnswer';
import { CitationChips } from '../components/CitationChips';
import { DrillPicker, ExamResultView, ExamRunner, Flashcards, WhyWrong } from './PracticeParts';
import { useProjectStore } from '../stores';
import { check, missedExercises, practiceSet, streak, topicScores, useExerciseStore, type Exercise, type TableRow, type Verdict } from '../study/exercises';
import { generatePractice } from '../study/practice';
import { ACCOUNTING_DRILLS, STATS_DRILLS, makeDrillSet, type DrillKind } from '../study/drills';
import { buildExam, gradeExam, type Exam, type ExamResult } from '../study/exam';


export const PracticeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { projectId } = useRoute<any>().params as { projectId: string };
  const { colors } = useTheme();
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));
  const { exercises, progress, daily, goal, addSet, record, saveDraft, freshen, setNote: saveNote, setGoal } = useExerciseStore();
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<Exercise[]>([]);
  const [verdict, setVerdict] = useState<Verdict | undefined>();
  const [note, setNote] = useState('');
  const [exam, setExam] = useState<Exam | null>(null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<ExamResult | null>(null);
  const [cards, setCards] = useState<Exercise[] | null>(null);
  const [pickDrill, setPickDrill] = useState(false);
  const all = useMemo(() => Object.values(exercises), [exercises]);
  const current = queue[0];
  const scores = topicScores(all, progress);
  const today = new Date().toISOString().slice(0, 10);

  const queueUp = (list: Exercise[]) => { freshen(list.map((e) => e.id)); setQueue(list); };
  const make = async () => {
    setBusy(true); setNote('');
    try {
      const r = await generatePractice(projectId, topic);
      setNote(`${r.added} questions added${r.dropped ? `, ${r.dropped} skipped (${r.reasons.join(', ')})` : ''}.`);
      queueUp(practiceSet(Object.values(useExerciseStore.getState().exercises), useExerciseStore.getState().progress, { topic: topic.trim() || undefined }));
    } catch (e: any) { Alert.alert('Could not make questions', String(e?.message || e)); } finally { setBusy(false); }
  };
  const drills = (kinds: DrillKind[]) => { const set = makeDrillSet(8, Date.now() % 100000, kinds); addSet(set); setVerdict(undefined); setNote(''); setPickDrill(false); queueUp(set); };
  const start = (t?: string) => { setVerdict(undefined); queueUp(practiceSet(all, progress, { topic: t })); if (!all.length) setNote('No questions yet. Make some from your documents.'); };
  const value = current ? progress[current.id]?.saved : undefined;
  const submit = () => { if (!current) return; const v = check(current, value); setVerdict(v); record(current.id, v.correct); };
  const next = () => { setVerdict(undefined); setQueue((q) => q.slice(1)); };

  const startExam = () => {
    if (!all.length) { setNote('No questions yet. Make some from your documents, or start some drills first.'); return; }
    setAnswers({}); setResult(null);
    setExam(buildExam(all, progress, { count: Math.min(20, all.length), minutes: 30 }));
  };
  const finishExam = React.useCallback(() => {
    if (!exam) return;
    const graded = gradeExam(exam, useExerciseStore.getState().exercises, answersRef.current);
    exam.ids.forEach((id) => { const ex = useExerciseStore.getState().exercises[id]; if (ex) record(id, !graded.wrong.includes(id)); });
    setResult(graded); setExam(null);
  }, [exam, record]);
  const answersRef = React.useRef<Record<string, unknown>>({});
  answersRef.current = answers;
  const reviewMisses = () => { if (!result) return; queueUp(result.wrong.map((id) => exercises[id]).filter(Boolean)); setResult(null); };
  const startCards = () => { const missed = missedExercises(all, progress); if (!missed.length) { setNote('Nothing missed yet, so no flashcards.'); return; } setCards(missed); };

  const inRun = !!current;
  const home = !inRun && !exam && !result && !cards;
  const done = daily[today] ?? 0;
  return (
    <SafeAreaView style={[st.flex, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={[st.title, { color: colors.text }]}>Practice: {project?.name || ''}</Text>
      </View>
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        {exam && <ExamRunner exam={exam} questions={exam.ids.map((id) => exercises[id]).filter(Boolean)} answers={answers} onAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))} onFinish={finishExam} colors={colors} />}
        {result && <ExamResultView result={result} onReview={reviewMisses} onDone={() => setResult(null)} colors={colors} />}
        {cards && <Flashcards cards={cards} colors={colors} onStop={() => setCards(null)}
          onGotIt={(id) => setCards((c) => (c ?? []).filter((x) => x.id !== id))} onAgain={(id) => setCards((c) => { const rest = (c ?? []).filter((x) => x.id !== id); const me = (c ?? []).find((x) => x.id === id); return me ? [...rest, me] : rest; })} />}
        {home && (
          <View>
            {goal.on && <Text testID="goal-line" style={{ color: done >= goal.perDay ? good : colors.textSecondary }}>Today: {done} of {goal.perDay} questions. Streak: {streak(daily, today, goal.perDay)} day{streak(daily, today, goal.perDay) === 1 ? '' : 's'}.</Text>}
            <TextInput testID="practice-topic" value={topic} onChangeText={setTopic} placeholder="Topic or chapter (optional)" placeholderTextColor={colors.textMuted} style={[st.input, st.top8, { borderColor: colors.border, color: colors.text }]} />
            <Button title={busy ? 'Writing questions...' : 'Make questions from my documents'} onPress={make} loading={busy} disabled={busy} testID="practice-make" style={st.top10} />
            <Button title="Accounting drills (balance sheet, interest, loans, statements...)" variant="outline" onPress={() => drills(ACCOUNTING_DRILLS)} testID="practice-drills" style={st.top8} />
            <Button title="Research statistics drills (doctoral courses)" variant="outline" onPress={() => drills(STATS_DRILLS)} testID="practice-stats-drills" style={st.top8} />
            <Button title={pickDrill ? 'Hide drill types' : 'Pick one drill type'} variant="ghost" onPress={() => setPickDrill(!pickDrill)} testID="practice-pick-drill" style={st.top6} />
            {pickDrill && <DrillPicker kinds={[...ACCOUNTING_DRILLS, ...STATS_DRILLS]} onPick={(k) => drills([k])} colors={colors} />}
            <Button title="Practise what I have (missed and due first)" variant="outline" onPress={() => start(topic.trim() || undefined)} testID="practice-start" style={st.top8} />
            <Button title="Timed exam (20 questions, 30 minutes)" variant="outline" onPress={startExam} testID="practice-exam" style={st.top8} />
            <Button title="Flashcards from my misses" variant="outline" onPress={startCards} testID="practice-cards" style={st.top8} />
            {!!note && <Text testID="practice-note" style={[st.top10, { color: colors.textSecondary }]}>{note}</Text>}
            <View style={[st.wrap, st.top14]}>
              <Switch value={goal.on} onValueChange={(on) => setGoal({ on })} testID="goal-switch" />
              <Text style={[st.gap, { color: colors.textSecondary }]}>Daily goal and streak ({goal.perDay} questions a day)</Text>
            </View>
            {scores.length > 0 && <View style={st.top18}>
              <Text style={[st.semi, { color: colors.text }]}>Score by topic (weakest first)</Text>
              {scores.map((s) => <TouchableOpacity key={s.topic} onPress={() => start(s.topic)} style={st.pad8}>
                <Text style={{ color: s.percent < 60 ? colors.error : colors.text }}>{s.topic}: {s.percent}% ({s.attempts} tries)</Text></TouchableOpacity>)}
            </View>}
          </View>
        )}
        {inRun && current && (
          <View>
            <Text style={[st.small12, { color: colors.textMuted }]}>{queue.length} left{current.topic ? ` - ${current.topic}` : ''}</Text>
            <Text testID="practice-prompt" style={[st.prompt, { color: colors.text }]}>{current.kind === 'testlet' ? 'Answer all parts' : current.prompt}</Text>
            {!!progress[current.id]?.note && !verdict && <Text testID="earlier-note" style={[st.top8, { color: colors.textSecondary }]}>Your note from last time: {progress[current.id].note}</Text>}
            <Answer ex={current} value={value} onChange={(v) => saveDraft(current.id, v)} verdict={verdict} colors={colors} />
            {verdict && <View style={st.top14}>
              <Text testID="practice-result" style={[st.semi, { color: verdict.correct ? good : colors.error }]}>{verdict.correct ? 'Correct' : 'Not quite'}{verdict.note ? ` - ${verdict.note}` : ''}</Text>
              {!!current.explain && <Text style={[st.top4, { color: colors.textSecondary }]}>{current.explain}</Text>}
              {current.source && <CitationChips cites={[{ title: current.source.doc, page: current.source.page, section: current.source.section, quote: current.source.quote, verified: true }]} />}
              {!verdict.correct && <WhyWrong value={progress[current.id]?.note} onChange={(t) => saveNote(current.id, t)} colors={colors} />}
            </View>}
            <Button title={verdict ? 'Next' : 'Check'} onPress={verdict ? next : submit} testID={verdict ? 'practice-next' : 'practice-check'} style={st.top14} />
            <Button title="Stop" variant="ghost" onPress={() => { setQueue([]); setVerdict(undefined); }} style={st.top6} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

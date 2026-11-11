import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { st } from '../components/practiceStyles';
import { ExamResultView, ExamRunner, Flashcards, PracticeHome, PracticeRun } from './PracticeParts';
import { useProjectStore } from '../stores';
import { keepScreenOn } from '../atlasVoice/tts';
import { check, missedExercises, practiceSet, streak, topicScores, useExerciseStore, type Exercise, type Verdict } from '../study/exercises';
import { generatePractice } from '../study/practice';
import { makeDrillSet, type DrillKind } from '../study/drills';
import { buildExam, gradeExam, type Exam, type ExamResult } from '../study/exam';

const todayKey = () => new Date().toISOString().slice(0, 10);

export const PracticeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { projectId } = useRoute<any>().params as { projectId: string };
  const { colors } = useTheme();
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));
  const { exercises, progress, daily, goal, addSet, record, saveDraft, freshen, setNote: saveNote, setGoal, clearAll } = useExerciseStore();
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
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const all = useMemo(() => Object.values(exercises), [exercises]);
  const current = queue[0];
  const today = todayKey();

  // A timed exam keeps the screen on, and lets it sleep again afterwards or when leaving.
  useEffect(() => { keepScreenOn(!!exam); return () => keepScreenOn(false); }, [exam]);

  const queueUp = (list: Exercise[]) => { freshen(list.map((e) => e.id)); setVerdict(undefined); setQueue(list); };
  const make = async () => {
    setBusy(true); setNote('');
    try {
      const r = await generatePractice(projectId, topic);
      setNote(`${r.added} questions added${r.dropped ? `, ${r.dropped} skipped (${r.reasons.join(', ')})` : ''}.`);
      const fresh = useExerciseStore.getState();
      queueUp(practiceSet(Object.values(fresh.exercises), fresh.progress, { topic: topic.trim() || undefined }));
    } catch (e: any) { Alert.alert('Could not make questions', String(e?.message || e)); } finally { setBusy(false); }
  };
  const drills = (kinds: DrillKind[]) => { const set = makeDrillSet(8, Date.now() % 100000, kinds); addSet(set); setNote(''); setPickDrill(false); queueUp(set); };
  const start = (t?: string) => { queueUp(practiceSet(all, progress, { topic: t })); if (!all.length) setNote('No questions yet. Make some from your documents.'); };
  const submit = () => { if (!current) return; const v = check(current, progress[current.id]?.saved); setVerdict(v); record(current.id, v.correct); };
  const next = () => { setVerdict(undefined); setQueue((q) => q.slice(1)); };

  const startExam = () => {
    if (!all.length) { setNote('No questions yet. Make some from your documents, or start some drills first.'); return; }
    setAnswers({}); setResult(null);
    setExam(buildExam(all, progress, { count: Math.min(20, all.length), minutes: 30 }));
  };
  const finishExam = useCallback(() => {
    if (!exam) return;
    const bank = useExerciseStore.getState().exercises;
    const graded = gradeExam(exam, bank, answersRef.current);
    exam.ids.forEach((id) => { if (bank[id]) record(id, !graded.wrong.includes(id)); });
    setResult(graded); setExam(null);
  }, [exam, record]);
  const reviewMisses = () => { if (result) { queueUp(result.wrong.map((id) => exercises[id]).filter(Boolean)); setResult(null); } };
  const startCards = () => { const missed = missedExercises(all, progress); if (missed.length) setCards(missed); else setNote('Nothing missed yet, so no flashcards.'); };
  const confirmClear = () => Alert.alert('Clear practice history?', 'This deletes the saved practice questions, your scores and notes. Drills can always be made again.', [
    { text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => { clearAll(); setNote('Practice history cleared.'); } },
  ]);

  const done = daily[today] ?? 0;
  const days = streak(daily, today, goal.perDay);
  const home = !current && !exam && !result && !cards;
  return (
    <SafeAreaView style={[st.flex, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={[st.title, { color: colors.text }]}>Practice: {project?.name || ''}</Text>
      </View>
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        {exam && <ExamRunner exam={exam} questions={exam.ids.map((id) => exercises[id]).filter(Boolean)} answers={answers} onAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))} onFinish={finishExam} colors={colors} />}
        {result && <ExamResultView result={result} onReview={reviewMisses} onDone={() => setResult(null)} colors={colors} />}
        {cards && (
          <Flashcards cards={cards} colors={colors} onStop={() => setCards(null)}
            onGotIt={(id) => setCards((c) => (c ?? []).filter((x) => x.id !== id))}
            onAgain={(id) => setCards((c) => { const me = (c ?? []).find((x) => x.id === id); return me ? [...(c ?? []).filter((x) => x.id !== id), me] : c; })} />
        )}
        {home && (
          <PracticeHome topic={topic} setTopic={setTopic} busy={busy} note={note} pickDrill={pickDrill} setPickDrill={setPickDrill}
            goalOn={goal.on} perDay={goal.perDay} setGoalOn={(on) => setGoal({ on })}
            goalLine={goal.on ? `Today: ${done} of ${goal.perDay} questions. Streak: ${days} day${days === 1 ? '' : 's'}.` : null}
            scores={topicScores(all, progress)} onMake={make} onDrills={drills} onStart={start} onExam={startExam} onCards={startCards} onClear={confirmClear} colors={colors} />
        )}
        {current && (
          <PracticeRun current={current} left={queue.length} value={progress[current.id]?.saved} earlierNote={progress[current.id]?.note} verdict={verdict} note={progress[current.id]?.note}
            onDraft={(v) => saveDraft(current.id, v)} onCheck={submit} onNext={next} onStop={() => { setQueue([]); setVerdict(undefined); }}
            onNote={(t) => saveNote(current.id, t)} colors={colors} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

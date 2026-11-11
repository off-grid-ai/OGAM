import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { Button } from '../components/Button';
import { unitById } from './curriculum';
import { LANGUAGES, MISTAKES, MY_WORDS, PRACTICE, REVIEW, languageService } from './languageService';
import { levelGuide } from './teaching';
import { lessonKey, partItems } from './board';
import { LESSON_SECONDS } from './pace';
import { buildLesson, difficultyFor, checkSpoken, checkTyped, repeatMissed, scored, type Exercise } from './lessons';
import { useLanguage } from './store';
import type { Item } from './lessons';
import type { LevelId } from './teaching';
import { ExerciseView, type Attempt } from './Exercises';
import { createStyles } from './LessonScreen.styles';
import { playFeedback } from './sounds';
import { HelpSheet, exerciseContext } from './HelpSheet';

const EMPTY: Attempt = { value: '', checked: false };

const SPEED_SECONDS = 60;

type Mode = 'speed' | 'review' | 'checkpoint' | 'exam';
const MODE_TITLE: Record<Mode, string> = { speed: 'Speed round', review: 'Review', checkpoint: 'Checkpoint', exam: 'Exam' };
const lessonTitle = (unitId: string, mode?: Mode) =>
  (mode ? MODE_TITLE[mode] : unitId === MY_WORDS ? 'My words' : unitId === REVIEW ? 'Review' : unitId === MISTAKES ? 'My mistakes' : unitById(unitId)?.title ?? 'Lesson');

/** A checkpoint is passed at 80% right, an exam at 70%. */
const passMark = (mode?: Mode) => (mode === 'exam' ? 0.7 : 0.8);
const graded = (mode?: Mode) => mode === 'checkpoint' || mode === 'exam';

/** The words for this sitting: a unit's (or one part of it), a review square's, or the whole level's. */
function lessonWords(p: { unitId: string; mode?: Mode; level?: LevelId; key?: string; part: number; parts: number }, onStep: (m: string) => void): Promise<Item[]> {
  if (p.mode === 'review') return Promise.resolve().then(() => languageService.reviewSquareWords());
  if (p.mode === 'checkpoint') return Promise.resolve().then(() => languageService.levelWords(p.level ?? useLanguage.getState().level));
  if (p.mode === 'exam') return Promise.resolve().then(() => languageService.examWords(p.level ?? useLanguage.getState().level, p.key));
  return languageService.unitWords(p.unitId, onStep)
    .then((all) => (unitById(p.unitId) && !p.mode ? partItems(all, p.part, p.parts) : all));
}

function summaryText({ mode, right, total }: { mode?: Mode; right: number; total: number }): string {
  if (mode === 'speed') return `${right} right in ${SPEED_SECONDS} seconds`;
  if (graded(mode)) return right / Math.max(1, total) >= passMark(mode)
    ? `Passed: ${right} of ${total} right`
    : `${right} of ${total} right. You need ${Math.ceil(total * passMark(mode))} to pass: try again`;
  return `${right} of ${total} right`;
}

const feedbackText = (verdict: 'right' | 'accents' | 'wrong', answer: string) =>
  (verdict === 'right' ? 'Right.' : verdict === 'accents' ? `Right, but watch the accents: ${answer}` : `Not quite. Answer: ${answer}`);

/** Progress key: the board space, else the unit's lesson (practice-only for speed rounds without a space). */
const progressKey = ({ key, unitId, part = 1 }: { key?: string; unitId: string; part?: number }, speed: boolean) =>
  key ?? (speed ? PRACTICE : unitId === MY_WORDS || unitId === REVIEW || unitId === MISTAKES ? unitId : lessonKey(unitId, part));

/**
 * One board space's lesson, about five minutes long whatever its games (pace.ts): a grammar
 * or theme note first, then exercises from recognising to producing, then stars, XP and the
 * streak. Every answer updates the word's review schedule and the learner's pace, and the
 * lesson is saved as it goes, so leaving and coming back carries on where it stopped.
 * Speed round: as many as you can in a minute.
 */
export const LessonScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const params = useRoute<any>().params as { unitId: string; mode?: Mode; part?: number; parts?: number; key?: string; level?: LevelId };
  const { unitId, mode, part = 1, parts = 1 } = params;
  const speed = mode === 'speed';
  const key = progressKey(params, speed);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const code = useLanguage((s) => s.language);
  const langName = LANGUAGES.find((l) => l.code === code)?.name ?? code;
  const unit = unitById(unitId);
  const guide = levelGuide(unit?.level ?? useLanguage.getState().level);
  const title = parts > 1 && !mode ? `${lessonTitle(unitId)} ${part}/${parts}` : lessonTitle(unitId, mode);
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [step, setStep] = useState('Getting the words ready...');
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [right, setRight] = useState(0);
  const [attempt, setAttempt] = useState<Attempt>(EMPTY);
  const [result, setResult] = useState<{ stars: number; xp: number; streak: number } | null>(null);
  const [results, setResults] = useState<{ t: string; right: boolean }[]>([]);
  const [tip, setTip] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(SPEED_SECONDS);
  const [help, setHelp] = useState(false);

  const shownAt = useRef(Date.now());
  useEffect(() => { shownAt.current = Date.now(); }, [i, exercises]);

  const start = (fresh = false) => {
    setError(null); setExercises(null); setI(0); setRight(0); setAttempt(EMPTY); setResult(null); setResults([]); setSecondsLeft(SPEED_SECONDS);
    const saved = !speed && !fresh ? languageService.savedLesson(key) : undefined;
    if (saved) {
      // Carry on where the learner stopped.
      setExercises(saved.exercises); setI(saved.index); setRight(saved.right); setResults(saved.results); setTip('');
      return;
    }
    Promise.all([lessonWords({ unitId, mode, level: params.level, key, part, parts }, setStep), languageService.canSpeak()])
      .then(([items, speaking]) => {
        setTip(mode || part > 1 ? '' : languageService.tipFor(unitId));
        setExercises(buildLesson(items, Date.now(), speed
          ? { length: 40, production: 0 }
          : { seconds: graded(mode) ? LESSON_SECONDS * 2 : LESSON_SECONDS, secondsOf: languageService.secondsOf, production: guide.production, speaking, difficulty: difficultyFor(guide.id) }));
      })
      .catch((e) => setError(String(e?.message || e)));
  };
  useEffect(() => start(), [unitId, code, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ex = exercises?.[i];
  const verdict = !ex || ex.kind === 'match' ? 'wrong' : ex.kind === 'speak' ? checkSpoken(attempt.value, ex.answer) : checkTyped(attempt.value, ex.answer);
  const correct = verdict !== 'wrong';
  const finish = (score: number, done: { t: string; right: boolean }[], list = exercises!) => {
    languageService.saveLesson(null);
    const total = speed ? Math.max(score, i + 1) : scored(list);
    const passed = !graded(mode) || score / Math.max(1, total) >= passMark(mode);
    if (mode && params.key && passed) languageService.completeSpace(params.key);
    // Special squares are practice: the square is marked above, the words' memory and XP here.
    setResult(languageService.finishLesson(mode && params.key ? PRACTICE : key, { right: score, total, results: done }));
  };
  const next = (gotIt: boolean) => {
    if (!ex || !exercises) return;
    languageService.recordPace(ex.kind, (Date.now() - shownAt.current) / 1000);
    const list = speed ? exercises : repeatMissed(exercises, ex, gotIt);
    if (list !== exercises) setExercises(list);
    // A repeat is practice: the score and word memory count the first try only.
    const score = right + (gotIt && !ex.again ? 1 : 0);
    const words = ex.again ? [] : ex.kind === 'match' ? ex.pairs.map((p) => ({ t: p.t, right: gotIt })) : [{ t: ex.item.t, right: gotIt }];
    const done = [...results, ...words];
    setRight(score); setResults(done); setAttempt(EMPTY);
    if (i + 1 < list.length) {
      setI(i + 1);
      if (!speed) languageService.saveLesson({ key, exercises: list, index: i + 1, right: score, results: done });
      return;
    }
    finish(score, done, list);
  };
  // Speed round: the clock runs while exercises are on screen; when it hits zero the round ends.
  useEffect(() => {
    if (!speed || !exercises || result || tip) return;
    if (secondsLeft <= 0) { finish(right, results); return; }
    const t = setTimeout(() => setSecondsLeft(secondsLeft - 1), 1000);
    return () => clearTimeout(t);
  }, [speed, exercises, result, secondsLeft]); // eslint-disable-line react-hooks/exhaustive-deps
  const rewrite = () => Alert.alert('Write these words again?', 'The AI on your phone writes this unit\'s words again, for a wording that looks wrong.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Rewrite', onPress: () => { languageService.rewrite(unitId); start(true); } },
  ]);

  if (error || !exercises) return <LessonWaiting error={error} step={step} onRetry={() => start(true)} onFailed={setError} />;

  if (tip) return <LessonTip title={title} grammar={unit?.kind === 'grammar'} tip={tip} onStart={() => setTip('')} />;

  if (result) {
    return (
      <LessonDone title={title} result={result} summary={summaryText({ mode, right, total: scored(exercises) })}
        aiMade={languageService.isAiMade(unitId)} onAgain={() => start(true)} onRewrite={rewrite} />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Leave lesson"><Icon name="x" size={22} color={colors.text} /></TouchableOpacity>
        <View style={styles.bar}><View style={[styles.barFill, { width: `${(speed ? secondsLeft / SPEED_SECONDS : i / exercises.length) * 100}%` }]} /></View>
        {speed && <Text style={styles.meta} testID="speed-clock">{secondsLeft}s</Text>}
        <TouchableOpacity onPress={() => setHelp(true)} accessibilityLabel="Ask the tutor" testID="lesson-help">
          <Icon name="help-circle" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>
      <HelpSheet visible={help} onClose={() => setHelp(false)} context={exerciseContext(ex!, langName, languageService.tipFor(unitId))} />
      <ScrollView contentContainerStyle={styles.body}>
        {ex!.again && <Text style={styles.meta} testID="lesson-again">Once more: you missed this one earlier.</Text>}
        <ExerciseView key={i} ex={ex!} lang={code} langName={langName} attempt={attempt}
          onPick={(value) => setAttempt({ value, checked: false })} onMatched={(mistakes) => { playFeedback(mistakes <= 1); next(mistakes <= 1); }} onSkip={() => next(true)} />
      </ScrollView>
      {ex!.kind !== 'match' && (
        <View style={styles.footer}>
          {attempt.checked && (
            <Text style={styles.feedback} testID="lesson-feedback">
              {feedbackText(verdict, ex!.answer)}
            </Text>
          )}
          {attempt.checked
            ? <Button title="Continue" onPress={() => next(correct)} testID="lesson-continue" />
            : <Button title="Check" disabled={!attempt.value} onPress={() => { playFeedback(correct); setAttempt({ ...attempt, checked: true }); }} testID="lesson-check" />}
        </View>
      )}
    </SafeAreaView>
  );
};

/** Getting the words ready, or what went wrong, with a way to load the model by hand. */
function LessonWaiting({ error, step, onRetry, onFailed }: { error: string | null; step: string; onRetry: () => void; onFailed: (e: string) => void }) {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [loading, setLoading] = useState<string | null>(null);
  const forceLoad = () => {
    setLoading('Loading...');
    languageService.forceLoadModel(setLoading).then(() => { setLoading(null); onRetry(); })
      .catch((e) => { setLoading(null); onFailed(String(e?.message || e)); });
  };
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center}>
        {error ? <Text style={styles.feedback}>{error}</Text> : <><ActivityIndicator color={colors.primary} /><Text style={styles.meta}>{step}</Text></>}
        {!!error && <Button title="Try again" onPress={onRetry} />}
        {!!error && (loading
          ? <Text style={styles.meta}>{loading}</Text>
          : <Button title="Load the AI model now" variant="outline" testID="lesson-force-load" onPress={forceLoad} />)}
        <Button title="Back" variant="ghost" onPress={() => navigation.goBack()} />
      </View>
    </SafeAreaView>
  );
}

function LessonTip({ title, grammar, tip, onStart }: { title: string; grammar: boolean; tip: string; onStart: () => void }) {
  const styles = useThemedStyles(createStyles);
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.body} testID="lesson-tip">
        <Text style={styles.prompt}>{grammar ? 'How it works' : 'Good to know'}</Text>
        <Text style={styles.big}>{title}</Text>
        <Text style={styles.tip}>{tip}</Text>
        <Button title="Start the lesson" onPress={onStart} testID="lesson-start" />
      </ScrollView>
    </SafeAreaView>
  );
}

function LessonDone({ title, result, summary, aiMade, onAgain, onRewrite }: {
  title: string; result: { stars: number; xp: number; streak: number }; summary: string; aiMade: boolean; onAgain: () => void; onRewrite: () => void;
}) {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center} testID="lesson-done">
        <Text style={styles.big}>{title} done</Text>
        <View style={styles.starsRow}>{[1, 2, 3].map((n) => <Icon key={n} name="star" size={36} color={n <= result.stars ? colors.primary : colors.border} />)}</View>
        <Text style={styles.feedback}>{summary} · +{result.xp} XP · {result.streak} day streak</Text>
        <Button title="Back to the board" onPress={() => navigation.goBack()} testID="lesson-back" />
        <Button title="Practice again" variant="outline" onPress={onAgain} />
        {aiMade && (
          <TouchableOpacity onPress={onRewrite}><Text style={styles.meta}>Written by the AI on your phone. Wording looks wrong? Rewrite it.</Text></TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

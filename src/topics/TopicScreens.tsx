import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { Button } from '../components/Button';
import { ForceLoadModel } from '../components/ForceLoadModel';
import { Board } from '../language/Board';
import type { Space, SpaceKind } from '../language/board';
import { FORMATS, type SquareContent, type SquareFormat } from './formats';
import { courseProgress, useTopics, type Course } from './store';
import { createCourse, squareContent } from './service';
import { SquareView } from './SquareViews';

/** The board's colored band is chosen by a square's kind; each format borrows one so formats read apart at a glance. */
const BOARD_KIND: Record<SquareFormat, SpaceKind> = {
  lesson: 'lesson', quiz: 'speed', cards: 'story', match: 'wordsearch', order: 'podcast', practice: 'call',
};
const iconOf = (format: SquareFormat) => FORMATS.find((f) => f.id === format)?.icon ?? 'circle';

const LEVELS = ['Complete beginner', 'Know a little', 'Intermediate', 'Advanced'];
const SITTINGS = [5, 10, 15, 20];

function Chip({ label, on, onPress, testID }: { label: string; on: boolean; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} testID={testID} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={[styles.chip, on ? { borderColor: colors.primary, backgroundColor: colors.surface } : { borderColor: colors.border }]}>
      <Text style={{ color: on ? colors.primary : colors.textSecondary }}>{label}</Text>
    </TouchableOpacity>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} accessibilityLabel="Back"><Icon name="arrow-left" size={20} color={colors.text} /></TouchableOpacity>
      <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>{title}</Text>
    </View>
  );
}

/** Your courses, and a form to make a new one on any subject. */
export const TopicsScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { courses, remove } = useTopics();
  const [form, setForm] = useState(false);
  const [topic, setTopic] = useState('');
  const [goal, setGoal] = useState('');
  const [how, setHow] = useState('');
  const [level, setLevel] = useState(LEVELS[0]);
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setBusy(true); setError(null);
    try {
      const id = await createCourse({ topic: topic.trim(), goal: goal.trim(), level, how: how.trim(), minutes });
      setForm(false); setTopic(''); setGoal(''); setHow('');
      navigation.navigate('TopicBoard', { courseId: id });
    } catch (e: any) { setError(String(e?.message || e)); }
    setBusy(false);
  };
  const confirmDelete = (c: Course) => Alert.alert('Delete this course?', c.title, [
    { text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => remove(c.id) },
  ]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <Header title="Learn a topic" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.meta, { color: colors.textMuted }]}>
          Name anything: accounting, Python, the French Revolution, guitar chords. The AI on your phone designs a board for it, choosing lessons, quizzes, flashcards, matching, ordering and practice problems to suit the subject and how you like to learn, and writes each square when you reach it.
        </Text>
        {courses.map((c) => {
          const p = courseProgress(c);
          return (
            <TouchableOpacity key={c.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
              onPress={() => navigation.navigate('TopicBoard', { courseId: c.id })} onLongPress={() => confirmDelete(c)} testID={`course-${c.id}`}>
              <Text style={[styles.name, { color: colors.text }]}>{c.title}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>{c.summary || c.topic}</Text>
              <Text style={[styles.meta, { color: colors.textMuted }]}>{p.done} of {p.total} squares · hold to delete</Text>
            </TouchableOpacity>
          );
        })}
        {!courses.length && !form && <Text style={[styles.meta, { color: colors.textMuted }]} testID="topics-empty">No courses yet.</Text>}

        {!form && <Button title="New course" onPress={() => setForm(true)} testID="course-new" />}
        {form && (
          <View style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.surface }]} testID="course-form">
            <TextInput value={topic} onChangeText={setTopic} placeholder="What do you want to learn?" placeholderTextColor={colors.textMuted}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]} testID="course-topic" />
            <TextInput value={goal} onChangeText={setGoal} multiline placeholder="What do you want to be able to do? (optional)" placeholderTextColor={colors.textMuted}
              style={[styles.input, { color: colors.text, borderColor: colors.border }]} testID="course-goal" />
            <Text style={[styles.meta, { color: colors.textSecondary }]}>Where are you now?</Text>
            <View style={styles.chips}>{LEVELS.map((l) => <Chip key={l} label={l} on={level === l} onPress={() => setLevel(l)} testID={`course-level-${l.split(' ')[0].toLowerCase()}`} />)}</View>
            <TextInput value={how} onChangeText={setHow} multiline placeholder="How do you like to learn? (optional) e.g. lots of practice problems, short lessons, real examples"
              placeholderTextColor={colors.textMuted} style={[styles.input, { color: colors.text, borderColor: colors.border }]} testID="course-how" />
            <Text style={[styles.meta, { color: colors.textSecondary }]}>Minutes per square</Text>
            <View style={styles.chips}>{SITTINGS.map((m) => <Chip key={m} label={`${m}`} on={minutes === m} onPress={() => setMinutes(m)} testID={`course-minutes-${m}`} />)}</View>
            {busy && <View style={styles.row}><ActivityIndicator color={colors.primary} /><Text style={[styles.meta, { color: colors.textSecondary }]}>Designing your board...</Text></View>}
            {!!error && <Text style={{ color: colors.error }} testID="course-error">{error}</Text>}
            <ForceLoadModel testID="course-force-load" />
            <View style={styles.row}>
              <Button title="Make my course" onPress={make} disabled={!topic.trim() || busy} testID="course-make" />
              <Button title="Cancel" variant="ghost" onPress={() => setForm(false)} disabled={busy} testID="course-cancel" />
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

/** One course drawn as a board game. */
export const TopicBoardScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { courseId } = useRoute<any>().params as { courseId: string };
  const course = useTopics((s) => s.courses.find((c) => c.id === courseId));
  if (!course) return <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}><Header title="Course" onBack={() => navigation.goBack()} /></SafeAreaView>;

  const done = (key: string) => !!course.progress[key];
  const spaces: Space[] = course.squares.map((s) => ({ key: s.key, kind: s.checkpoint ? 'checkpoint' : BOARD_KIND[s.format], title: s.title, icon: iconOf(s.format) }));
  const current = Math.max(0, spaces.findIndex((s) => !done(s.key)));
  const open = (i: number) => i === 0 || done(spaces[i - 1].key) || done(spaces[i].key);
  const p = courseProgress(course);
  const stars = Object.values(course.progress).reduce((n, x) => n + x.stars, 0);
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <Header title={course.theme || course.title} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.name, { color: colors.text }]}>{course.title}</Text>
        {!!course.summary && <Text style={[styles.meta, { color: colors.textSecondary }]}>{course.summary}</Text>}
        {!!course.style && <Text style={[styles.meta, { color: colors.textMuted }]} testID="course-style">How it teaches: {course.style}</Text>}
        <Text style={[styles.meta, { color: colors.textMuted }]} testID="course-progress">{p.done} of {p.total} squares · {stars} stars</Text>
        <Board spaces={spaces} isDone={done} isOpen={open} current={current}
          onPress={(s) => navigation.navigate('TopicSquare', { courseId, key: s.key })} />
      </ScrollView>
    </SafeAreaView>
  );
};

/** One square: written when first opened, then played. */
export const TopicSquareScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { courseId, key } = useRoute<any>().params as { courseId: string; key: string };
  const course = useTopics((s) => s.courses.find((c) => c.id === courseId));
  const square = course?.squares.find((s) => s.key === key);
  const [content, setContent] = useState<SquareContent | null>(course?.content[key] ?? null);
  const [error, setError] = useState<string | null>(null);
  const [stars, setStars] = useState<number | null>(null);

  const load = React.useCallback(() => {
    if (!course) return;
    setError(null);
    squareContent(course, key).then(setContent).catch((e) => setError(String(e?.message || e)));
  }, [course, key]);
  React.useEffect(() => { if (!content) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!course || !square) return <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}><Header title="Square" onBack={() => navigation.goBack()} /></SafeAreaView>;
  const finish = (n: 1 | 2 | 3) => { useTopics.getState().complete(courseId, key, n); setStars(n); };
  const index = course.squares.findIndex((s) => s.key === key);
  const next = course.squares[index + 1];
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <Header title={square.title} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.meta, { color: colors.textMuted }]}>{FORMATS.find((f) => f.id === square.format)?.label} · {square.unit}</Text>
        {stars !== null ? (
          <View style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.surface }]} testID="square-finished">
            <Text style={[styles.name, { color: colors.text }]}>{'★'.repeat(stars)}{'☆'.repeat(3 - stars)}</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{next ? `Next: ${next.title}` : 'You finished the course.'}</Text>
            {next && <Button title="Next square" onPress={() => navigation.replace('TopicSquare', { courseId, key: next.key })} testID="square-next" />}
            <Button title="Back to the board" variant="outline" onPress={() => navigation.goBack()} testID="square-board" />
          </View>
        ) : content ? (
          <SquareView content={content} onDone={finish} />
        ) : error ? (
          <View style={styles.gap}>
            <Text style={{ color: colors.error }} testID="square-error">{error}</Text>
            <ForceLoadModel testID="square-force-load" />
            <Button title="Try again" onPress={load} testID="square-retry" />
          </View>
        ) : (
          <View style={styles.row}><ActivityIndicator color={colors.primary} /><Text style={[styles.meta, { color: colors.textSecondary }]} testID="square-writing">Writing this square...</Text></View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  title: { fontSize: 22, fontWeight: '400', flex: 1 },
  body: { padding: 16, gap: 12, paddingBottom: 60 },
  meta: { fontSize: 13 },
  name: { fontSize: 18, fontWeight: '400' },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  gap: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10 },
});

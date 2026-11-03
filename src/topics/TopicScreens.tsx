import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { useAppStore, useChatStore, useProjectStore } from '../stores';
import { Button } from '../components/Button';
import { ForceLoadModel } from '../components/ForceLoadModel';
import { Board } from '../language/Board';
import type { Space, SpaceKind } from '../language/board';
import { FORMATS, type SquareContent, type SquareFormat } from './formats';
import { courseProgress, useTopics, type Course } from './store';
import { createCourse, findSources, squareContent } from './service';
import { makeSource, type CourseSource } from './sources';
import { SquareView } from './SquareViews';

/** The board's colored band is chosen by a square's kind; each format borrows one so formats read apart at a glance. */
const BOARD_KIND: Record<SquareFormat, SpaceKind> = {
  lesson: 'lesson', quiz: 'speed', cards: 'story', match: 'wordsearch', order: 'podcast', practice: 'call',
  fill: 'speed', truefalse: 'speed', scenario: 'call', numeric: 'crossword', worked: 'lesson', table: 'review',
  recall: 'story', fix: 'wordsearch', tablefill: 'crossword', sort: 'podcast', dictation: 'story', reading: 'review', predict: 'speed',
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
  const given = (useRoute<any>().params ?? {}) as { projectId?: string; topic?: string };
  const all = useTopics((s) => s.courses);
  const remove = useTopics((s) => s.remove);
  const projectName = useProjectStore((s) => s.projects.find((p) => p.id === given.projectId)?.name);
  const courses = given.projectId ? all.filter((c) => c.projectId === given.projectId) : all;
  const [form, setForm] = useState(false);
  const [topic, setTopic] = useState(given.topic ?? '');
  const [goal, setGoal] = useState('');
  const [how, setHow] = useState('');
  const [level, setLevel] = useState(LEVELS[0]);
  const [minutes, setMinutes] = useState(10);
  const [online, setOnline] = useState(false);
  const [step, setStep] = useState('Designing your board...');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setBusy(true); setError(null); setStep('Designing your board...');
    try {
      const sources = online ? await findSources(topic.trim(), goal.trim(), setStep) : [];
      setStep('Designing your board...');
      const id = await createCourse({ topic: topic.trim(), goal: goal.trim(), level, how: how.trim(), minutes }, sources, given.projectId);
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
      <Header title={projectName ? `Courses in ${projectName}` : 'Learn a topic'} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.meta, { color: colors.textMuted }]}>
          {projectName ? `A course in this project: the project's shared documents are used as material, and the tutor chats live in the project. ` : ''}Name anything: accounting, Python, the French Revolution, guitar chords. The AI on your phone designs a board for it, choosing lessons, quizzes, flashcards, matching, ordering and practice problems to suit the subject and how you like to learn, and writes each square when you reach it.
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
            <TouchableOpacity style={styles.row} onPress={() => setOnline(!online)} testID="course-online" accessibilityRole="switch" accessibilityState={{ checked: online }}>
              <Icon name={online ? 'check-square' : 'square'} size={18} color={online ? colors.primary : colors.textMuted} />
              <Text style={[styles.meta, styles.grow, { color: colors.textSecondary }]}>Look for good sources online first and build the course from them (uses the internet)</Text>
            </TouchableOpacity>
            {busy && <View style={styles.row}><ActivityIndicator color={colors.primary} /><Text style={[styles.meta, { color: colors.textSecondary }]} testID="course-step">{step}</Text></View>}
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


/** The material a course is written from: pages the AI found online, pasted notes, text files. */
function SourcesCard({ course }: { course: Course }) {
  const { colors } = useTheme();
  const sources = course.sources ?? [];
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [noting, setNoting] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteText, setNoteText] = useState('');
  const add = (list: CourseSource[]) => useTopics.getState().addSources(course.id, list);

  const find = async () => {
    setBusy(true); setError(null);
    try { add(await findSources(course.topic, course.request.goal, setStep)); } catch (e: any) { setError(String(e?.message || e)); }
    setBusy(false);
  };
  const saveNote = () => {
    add([makeSource({ title: noteTitle || 'My notes', kind: 'note', text: noteText }, `note-${Date.now()}`)]);
    setNoting(false); setNoteTitle(''); setNoteText('');
  };
  const pickFile = async () => {
    setError(null);
    try {
      const { pick, types } = require('@react-native-documents/picker');
      const RNFS = require('react-native-fs').default ?? require('react-native-fs');
      const { resolvePickedFileUri } = require('../utils/resolvePickedFileUri');
      const file = (await pick({ mode: 'open', type: [types.allFiles], allowMultiSelection: false }))?.[0];
      if (!file) return;
      const local = (await resolvePickedFileUri(file.uri, file.name || 'notes.txt')).replace(/^file:\/\//, '');
      const text: string = await RNFS.readFile(local, 'utf8');
      if (text.trim().length < 50) { setError('That file has very little text in it. Use a .txt or .md file.'); return; }
      add([makeSource({ title: file.name || 'File', kind: 'file', text }, `file-${Date.now()}`)]);
    } catch (e: any) { if (e?.code !== 'OPERATION_CANCELED') setError(String(e?.message || e)); }
  };
  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID="course-sources">
      <Text style={[styles.name, { color: colors.text }]}>Sources ({sources.length})</Text>
      <Text style={[styles.meta, { color: colors.textMuted }]}>Squares are written from these where they cover the point. Squares already written stay as they are.</Text>
      {sources.map((x) => (
        <View key={x.id} style={styles.row}>
          <Icon name={x.kind === 'web' ? 'globe' : x.kind === 'file' ? 'file-text' : 'edit-3'} size={14} color={colors.textMuted} />
          <Text style={[styles.meta, styles.grow, { color: colors.textSecondary }]} numberOfLines={1}>{x.title}</Text>
          <TouchableOpacity onPress={() => useTopics.getState().removeSource(course.id, x.id)} testID={`source-remove-${x.id}`} accessibilityLabel={`Remove ${x.title}`}><Icon name="x" size={16} color={colors.textMuted} /></TouchableOpacity>
        </View>
      ))}
      {busy && <View style={styles.row}><ActivityIndicator color={colors.primary} /><Text style={[styles.meta, { color: colors.textSecondary }]}>{step}</Text></View>}
      {!!error && <Text style={{ color: colors.error }} testID="sources-error">{error}</Text>}
      {noting ? (
        <View style={styles.gap}>
          <TextInput value={noteTitle} onChangeText={setNoteTitle} placeholder="Title" placeholderTextColor={colors.textMuted} style={[styles.input, { color: colors.text, borderColor: colors.border }]} testID="note-title" />
          <TextInput value={noteText} onChangeText={setNoteText} multiline placeholder="Paste your notes or text" placeholderTextColor={colors.textMuted} style={[styles.input, styles.tall, { color: colors.text, borderColor: colors.border }]} testID="note-text" />
          <View style={styles.row}>
            <Button title="Add" onPress={saveNote} disabled={noteText.trim().length < 20} testID="note-save" />
            <Button title="Cancel" variant="ghost" onPress={() => setNoting(false)} />
          </View>
        </View>
      ) : (
        <View style={styles.chips}>
          <Chip label="Find sources online" on={false} onPress={find} testID="sources-find" />
          <Chip label="Paste notes" on={false} onPress={() => setNoting(true)} testID="sources-note" />
          <Chip label="Add a text file" on={false} onPress={pickFile} testID="sources-file" />
        </View>
      )}
    </View>
  );
}

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
        <SourcesCard course={course} />
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
  const [addedRemedial, setAddedRemedial] = useState(false);

  const load = React.useCallback(() => {
    if (!course) return;
    setError(null);
    squareContent(course, key).then(setContent).catch((e) => setError(String(e?.message || e)));
  }, [course, key]);
  React.useEffect(() => { if (!content) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!course || !square) return <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}><Header title="Square" onBack={() => navigation.goBack()} /></SafeAreaView>;
  // A square that went badly gets a lesson right after it that explains the same thing another way.
  const finish = (n: 1 | 2 | 3) => {
    useTopics.getState().complete(courseId, key, n);
    if (n === 1 && square.format !== 'lesson') setAddedRemedial(useTopics.getState().addRemedial(courseId, key));
    setStars(n);
  };
  const again = () => { useTopics.getState().clearContent(courseId, key); setContent(null); setStars(null); setAddedRemedial(false); load(); };
  const askTutor = () => {
    const app = useAppStore.getState();
    const modelId = app.activeModelId ?? app.downloadedModels[0]?.id;
    if (!modelId) { Alert.alert('No model', 'Download or pick a text model first.'); return; }
    const chat = useChatStore.getState();
    const id = chat.createConversation(modelId, `${course.title}: ${square.title}`, course.projectId);
    navigation.navigate('Chat', {
      conversationId: id, ...(course.projectId ? { projectId: course.projectId } : {}),
      starter: `I'm working through the course "${course.title}" (${course.topic}), on the square "${square.title}": ${square.focus}. `,
    });
  };
  const index = course.squares.findIndex((s) => s.key === key);
  const next = useTopics.getState().courses.find((c) => c.id === courseId)?.squares[index + 1] ?? course.squares[index + 1];
  const results = course.squares.slice(Math.max(0, index - 2), index).map((q) => course.progress[q.key]?.stars ?? 0);
  const cruising = square.format === 'lesson' && results.length === 2 && results.every((n) => n === 3);
  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <Header title={square.title} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.meta, { color: colors.textMuted }]}>{FORMATS.find((f) => f.id === square.format)?.label} · {square.unit}</Text>
        {stars !== null ? (
          <View style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.surface }]} testID="square-finished">
            <Text style={[styles.name, { color: colors.text }]}>{'★'.repeat(stars)}{'☆'.repeat(3 - stars)}</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{next ? `Next: ${next.title}` : 'You finished the course.'}</Text>
            {addedRemedial && <Text style={[styles.meta, { color: colors.textSecondary }]} testID="square-remedial">That was a hard one, so a lesson that explains it another way comes next.</Text>}
            {square.format !== 'lesson' && <Button title="Try new questions" variant="ghost" onPress={again} testID="square-again" />}
            {next && <Button title="Next square" onPress={() => navigation.replace('TopicSquare', { courseId, key: next.key })} testID="square-next" />}
            <Button title="Back to the board" variant="outline" onPress={() => navigation.goBack()} testID="square-board" />
          </View>
        ) : content ? (
          <>
            <TouchableOpacity onPress={askTutor} testID="square-tutor" accessibilityLabel="Ask the tutor about this square">
              <Text style={{ color: colors.primary }}>Ask the tutor about this</Text>
            </TouchableOpacity>
            {square.format === 'lesson' && (
              <TouchableOpacity onPress={() => finish(2)} testID="square-skip" accessibilityLabel="I already know this">
                <Text style={{ color: colors.primary }}>{cruising ? 'You got the last two right. Skip this lesson?' : 'I already know this'}</Text>
              </TouchableOpacity>
            )}
            <SquareView content={content} onDone={finish} />
          </>
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
  grow: { flex: 1 },
  tall: { minHeight: 100 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10 },
});

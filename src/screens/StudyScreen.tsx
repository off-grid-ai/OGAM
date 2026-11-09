import React, { useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Linking, ScrollView, Share, Text, TextInput, TouchableOpacity, View, Modal, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { useProjectStore } from '../stores';
import { MarkdownText } from '../components/MarkdownText';
import { PodcastVoicePicker } from '../components/PodcastVoicePicker';
import { castLine, playLine, playJingle, stopPodcastAudio } from '../atlasVoice/podcastAudio';
import { BRIEF_PROJECT, useBriefPrefs } from '../atlasTools/dailyBrief';
import { generate, generatePodcast, podcastContextWarning, useStudyStore, StudyResult, Source, PodcastStyle } from '../study/engine';
import { briefingSummary, briefingTranscript, safeFileName, saveMarkdown, studyMarkdown } from '../study/exportFiles';
import { deckSlides, savePptx } from '../study/pptx';
import { ProjectLearningGame } from '../components/ProjectLearningGame';
import { ProjectGame } from '../components/games/ProjectGame';
import { generateGame, PROJECT_GAMES, type GameType } from '../study/games/generate';
import { dueItems, streakFrom, useStudyProgress } from '../study/progress';
import { Switch } from 'react-native';
import { speakAndWait, stop, listVoices, TtsVoice, keepScreenOn } from '../atlasVoice/tts';
import { useAtlasVoiceStore } from '../atlasVoice/store';
import { cancelVideoExport, exportSlidesVideo, openVideo, shareVideo, videoExportAvailable, VideoExportCancelled, type SavedVideo, type VideoProgress } from '../services/videoExport';

const KINDS: { kind: StudyResult['kind']; label: string; icon: string; desc: string }[] = [
  { kind: 'guide', label: 'Study guide', icon: 'book', desc: 'Summary, key ideas, terms' },
  { kind: 'formulas', label: 'Formula sheet', icon: 'percent', desc: 'Formulas, rules and numbers on one page' },
  { kind: 'cards', label: 'Flashcards', icon: 'layers', desc: 'Tap to flip' },
  { kind: 'quiz', label: 'Quiz', icon: 'check-square', desc: 'Multiple choice' },
  { kind: 'crossword', label: 'Crossword', icon: 'grid', desc: 'Terms and clues from project sources' },
  { kind: 'wordsearch', label: 'Word search', icon: 'search', desc: 'Find words from your documents' },
  { kind: 'match', label: 'Matching game', icon: 'link', desc: 'Connect terms to definitions' },
  { kind: 'outline', label: 'Mind map', icon: 'share-2', desc: 'Outline of the topic' },
  { kind: 'rubric' as any, label: 'Rubric check', icon: 'check-circle', desc: 'Paste a rubric and your draft: see which criteria you have not addressed' },
  { kind: 'plan' as any, label: 'Study plan', icon: 'calendar', desc: 'Exams in the order you sit them, daily targets, what is behind' },
  { kind: 'practice' as any, label: 'Practice questions', icon: 'edit-3', desc: 'Exam-style questions from your documents, checked in code, with review' },
  { kind: 'podcast', label: 'Podcast', icon: 'headphones', desc: 'An episode read aloud, with a time bar' },
  { kind: 'slides', label: 'Slides', icon: 'film', desc: 'Present them, save as PowerPoint, or save as a narrated video' },
];

/** Sources row: [1] [2] ... tap to read the exact passage an item came from. */
function SourceChips({ nums, sources, onOpen, colors }: { nums: number[]; sources: Source[]; onOpen: (s: Source) => void; colors: any }) {
  const list = nums.map((n) => sources.find((s) => s.n === n)).filter(Boolean) as Source[];
  if (!list.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
      {list.map((s) => (
        <TouchableOpacity key={s.n} onPress={() => onOpen(s)} style={{ backgroundColor: colors.background, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginRight: 6, marginTop: 4 }}>
          <Text style={{ color: colors.primary, fontSize: 12 }}>[{s.n}] {s.origin === 'web' ? '🌐 ' : s.origin === 'library' ? '📚 ' : ''}{s.doc.replace(/\.(md|txt|pdf)$/i, '').slice(0, 28)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export const StudyScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const projectId: string = route.params?.projectId;
  /** Open one saved item directly (e.g. a daily briefing); back then leaves the screen. */
  const openAt: number | undefined = route.params?.openAt;
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));
  const learningEnabled = project?.allowLearningActivities !== false;
  const savedRaw = useStudyStore((s) => s.saved[projectId]);
  const saved = savedRaw || [];
  const add = useStudyStore((s) => s.add);
  const remove = useStudyStore((s) => s.remove);
  const [topic, setTopic] = useState('');
  const progressItems = useStudyProgress((s) => s.items);
  const doneDays = useStudyProgress((s) => s.doneDays);
  const dueCount = React.useMemo(() => dueItems(projectId).length, [progressItems, projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  const streak = streakFrom(doneDays);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<StudyResult | null>(() => (openAt ? (useStudyStore.getState().saved[projectId] || []).find((r) => r.createdAt === openAt) ?? null : null));
  const [src, setSrc] = useState<Source | null>(null);
  const [flipped, setFlipped] = useState<Record<number, boolean>>({});
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [playing, setPlaying] = useState<number | null>(null);
  const stopRef = useRef(false);
  const stopEpisode = useRef(false);
  const [podOpen, setPodOpen] = useState(false);
  const [pod, setPod] = useState<{ prompt: string; minutes: number; hosts: 1 | 2 | 3; style: PodcastStyle; research: boolean }>({ prompt: '', minutes: 5, hosts: 2, style: 'casual', research: false });
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  React.useEffect(() => {
    void listVoices('en').then(setVoices).catch(() => setVoices([]));
    return () => { stopRef.current = true; stopEpisode.current = true; stop(); stopPodcastAudio(); cancelVideoExport(); keepScreenOn(false); }; // leaving the screen stops playback
  }, []);
  // Android back button closes the open item (and stops audio) instead of leaving the screen.
  React.useEffect(() => {
    if (!view) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { stopRef.current = true; stop(); stopPodcastAudio(); setPlaying(null); if (openAt) { navigation.goBack(); return true; } setView(null); return true; });
    return () => sub.remove();
  }, [view]);
  // Different installed voices for different hosts; with fewer voices, vary the pitch instead.
  const castVoice = (host: string, hosts: number) => castLine(host, hosts, voices);
  const rate = useAtlasVoiceStore((s) => s.rate);
  const [itemStart, setItemStart] = useState(0);
  const [resumeAt, setResumeAt] = useState(0);
  const [, setTick] = useState(0);
  const playToken = useRef(0);
  React.useEffect(() => {
    if (playing === null) return;
    const t = setInterval(() => setTick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [playing]);
  /** Rough speaking time of a text in seconds (about 155 words a minute at normal speed). */
  const secs = (t: string) => Math.max(1.5, (t.split(/\s+/).filter(Boolean).length / 2.6) / (rate || 1) + 0.4);

  /** Study results are saved with the app's ordinary data, outside a protected project's vault. */
  const blockedByProtection = (): boolean => {
    if (!project?.pinVerifier) return false;
    Alert.alert('Protected project', 'Study results are saved outside the PIN lock, so they cannot be made for a protected project. Permanently remove its protection first, or use a different project.');
    return true;
  };

  const makeEpisode = async () => {
    if (blockedByProtection()) return;
    stopEpisode.current = false;
    setPodOpen(false);
    setBusy('Podcast');
    keepScreenOn(true); // long job: don't let the phone sleep and pause it
    try {
      const r = await generatePodcast(projectId, { ...pod, hosts: voices.length >= 2 ? pod.hosts : 1, shouldStop: () => stopEpisode.current }, (m) => setBusy(m));
      add(projectId, r);
      setResumeAt(0);
      setView(r);
    } catch (e: any) {
      Alert.alert('Could not make the episode', String(e?.message || e));
    } finally { setBusy(null); keepScreenOn(false); }
  };

  const runGame = async (type: GameType) => {
    if (blockedByProtection()) return;
    const label = PROJECT_GAMES.find((g) => g.type === type)?.label || 'Game';
    setBusy(label);
    keepScreenOn(true);
    try {
      const r = await generateGame(projectId, type, topic, (m) => setBusy(m));
      // Review and daily read live progress; they are not worth saving as items.
      if (type !== 'review' && type !== 'daily') add(projectId, r);
      setResumeAt(0);
      setView(r);
    } catch (e: any) {
      Alert.alert('Could not make the game', String(e?.message || e));
    } finally { setBusy(null); keepScreenOn(false); }
  };

  const run = async (kind: StudyResult['kind']) => {
    if (blockedByProtection()) return;
    if ((kind as string) === 'rubric') { navigation.navigate('Rubric'); return; }
    if ((kind as string) === 'plan') { navigation.navigate('Planner'); return; }
    if ((kind as string) === 'practice') { navigation.navigate('Practice', { projectId }); return; }
    if (kind === 'podcast') { setPod((p) => ({ ...p, prompt: p.prompt || topic })); setPodOpen(true); return; }
    if (kind === 'answer' && !topic.trim()) { Alert.alert('Type a question first'); return; }
    setBusy(kind === 'answer' ? 'Answering' : KINDS.find((k) => k.kind === kind)?.label || kind);
    try {
      const r = await generate(projectId, kind, topic);
      add(projectId, r);
      setFlipped({}); setPicked({}); setResumeAt(0);
      setView(r);
    } catch (e: any) {
      Alert.alert('Could not make it', String(e?.message || e));
    } finally { setBusy(null); }
  };

  /** Plays from line `from`. A podcast (with `audioKey`) plays from pre-rendered audio files. */
  const play = async (items: { text: string; pitch: number; voice?: string }[], from = 0, audioKey?: string, storyStarts: number[] = []) => {
    const my = ++playToken.current;
    stop();
    stopPodcastAudio(); // a line playing from a file would otherwise play on top of the new one
    stopRef.current = false;
    keepScreenOn(true);
    let finished = false;
    // The daily briefing opens and closes with a short tune (switch in Daily briefing > Show options).
    const tunes = !!audioKey && audioKey.startsWith(`${BRIEF_PROJECT}-`) && useBriefPrefs.getState().jingles !== false;
    try {
      if (tunes && from <= 0 && !(await playJingle('intro'))) return;
      for (let i = Math.max(0, from); i < items.length; i++) {
        if (stopRef.current || playToken.current !== my) break;
        // A soft chime when the next story begins (not when playback starts or is moved to a line).
        if (tunes && i > from && storyStarts.includes(i) && !(await playJingle('chime'))) break;
        setPlaying(i); setResumeAt(i); setItemStart(Date.now());
        const ok = audioKey ? await playLine(audioKey, items, i) : await speakAndWait(items[i].text, items[i].pitch, 'podcast', items[i].voice || '');
        if (!ok || playToken.current !== my) break;
        if (i === items.length - 1) finished = true;
      }
      if (finished && tunes && playToken.current === my) await playJingle('outro');
    } catch (e: any) {
      Alert.alert('Playback stopped', String(e?.message || e));
    }
    if (playToken.current !== my) return; // a newer play (seek) took over
    keepScreenOn(false);
    setPlaying(null);
    if (finished) setResumeAt(0);
  };
  const halt = () => { playToken.current++; stopRef.current = true; stop(); stopPodcastAudio(); keepScreenOn(false); setPlaying(null); };

  const [exporting, setExporting] = useState<VideoProgress | null>(null);
  const [savedVideo, setSavedVideo] = useState<SavedVideo | null>(null);
  React.useEffect(() => { setSavedVideo(null); }, [view]); // a saved video belongs to the slides it was made from
  const saveVideo = async (title: string, slides: NonNullable<StudyResult['slides']>) => {
    halt();
    setSavedVideo(null);
    setExporting({ fraction: 0, stage: 'voice' });
    keepScreenOn(true); // encoding takes minutes; don't let the phone sleep
    try {
      setSavedVideo(await exportSlidesVideo(title, slides, setExporting));
    } catch (e: any) {
      if (!(e instanceof VideoExportCancelled)) Alert.alert('Could not save the video', String(e?.message || e));
    } finally { setExporting(null); keepScreenOn(false); }
  };
  const askSaveVideo = (title: string, slides: NonNullable<StudyResult['slides']>) => {
    if (project?.pinVerifier) {
      Alert.alert('Save outside the lock?', 'This project is PIN protected. The video is saved in your gallery (Movies/Atlas) without the PIN lock, and anything that can see your gallery can play it.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save video', onPress: () => { void saveVideo(title, slides); } },
      ]);
      return;
    }
    void saveVideo(title, slides);
  };
  const stageText = (p: VideoProgress) => (p.stage === 'voice' ? 'Recording the voice' : p.stage === 'audio' ? 'Encoding the sound' : 'Drawing the slides');
  const textHeading = (r: StudyResult) => r.title || `${KINDS.find((k) => k.kind === r.kind)?.label || 'Answer'}${r.topic ? `: ${r.topic}` : ''}`;
  const shareText = async (r: StudyResult) => {
    try { await Share.share({ title: textHeading(r), message: studyMarkdown(r, textHeading(r)) }); } catch { /* closed */ }
  };
  const saveText = async (r: StudyResult) => {
    try {
      const name = await saveMarkdown(safeFileName(textHeading(r), 'md'), studyMarkdown(r, textHeading(r)));
      if (name) Alert.alert('Saved', name);
    } catch (e: any) { Alert.alert('Could not save the file', String(e?.message || e)); }
  };
  const saveBriefing = async (r: StudyResult, what: 'transcript' | 'summary') => {
    try {
      const h = textHeading(r);
      const name = await saveMarkdown(safeFileName(what === 'summary' ? `${h} summary` : h, 'md'), what === 'summary' ? briefingSummary(r, h) : briefingTranscript(r, h));
      if (name) Alert.alert('Saved', name);
    } catch (e: any) { Alert.alert('Could not save the file', String(e?.message || e)); }
  };
  const savePowerPoint = async (r: StudyResult) => {
    try {
      const title = r.title || r.topic || 'Atlas slides';
      const name = await savePptx(safeFileName(title, 'pptx'), title, deckSlides(title, r.topic && r.topic !== title ? r.topic : '', r.slides ?? [], r.sources));
      if (name) Alert.alert('Saved', name);
    } catch (e: any) { Alert.alert('Could not save the PowerPoint', String(e?.message || e)); }
  };
  const openSource = (s: Source) => setSrc(s);
  const card = { backgroundColor: colors.surface, borderRadius: 10, padding: 14, marginBottom: 10 };

  const header = (title: string, back: () => void) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      <TouchableOpacity onPress={back} style={{ marginRight: 12 }}><Icon name="arrow-left" size={20} color={colors.text} /></TouchableOpacity>
      <Text style={{ color: colors.text, fontSize: 18, fontWeight: '600', flex: 1 }} numberOfLines={1}>{title}</Text>
      {busy && <ActivityIndicator color={colors.primary} />}
    </View>
  );

  const sourceModal = (
    <Modal visible={!!src} transparent animationType="fade" onRequestClose={() => setSrc(null)}>
      <TouchableOpacity activeOpacity={1} onPress={() => setSrc(null)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 16, maxHeight: '75%' }}>
          <Text style={{ color: colors.primary, fontWeight: '700' }}>Source [{src?.n}]</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 8 }}>{src?.doc} · part {src?.part}</Text>
          {!!src?.url && (
            <TouchableOpacity onPress={() => Linking.openURL(src.url!).catch(() => undefined)} style={{ marginBottom: 8 }}>
              <Text style={{ color: colors.primary }}>Open the full article (needs internet)</Text>
            </TouchableOpacity>
          )}
          <ScrollView><Text style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>{src?.text}</Text></ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  if (view) {
    const v = view;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
        {header(v.title || `${KINDS.find((k) => k.kind === v.kind)?.label || 'Answer'}${v.topic ? `: ${v.topic}` : ''}`, () => { halt(); if (openAt) navigation.goBack(); else setView(null); })}
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, width: '100%', maxWidth: 920, alignSelf: 'center' }}>
          {!!v.text && (
            <View style={card}>
              <MarkdownText>{v.text}</MarkdownText>
              <SourceChips nums={[...new Set([...v.text.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])))]} sources={v.sources} onOpen={openSource} colors={colors} />
              <View style={{ flexDirection: 'row', marginTop: 12 }}>
                <TouchableOpacity accessibilityRole="button" onPress={() => { void shareText(v); }} style={{ marginRight: 22 }}>
                  <Text style={{ color: colors.primary, fontSize: 14 }}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" onPress={() => { void saveText(v); }}>
                  <Text style={{ color: colors.primary, fontSize: 14 }}>Save as file (Markdown)</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {v.kind !== 'game' && (v.crossword || v.wordSearch || v.learningTerms) && <ProjectLearningGame key={v.createdAt} activity={v} onOpenSource={openSource} />}
          {v.kind === 'game' && <ProjectGame key={v.createdAt} result={v} projectId={projectId} onOpenSource={openSource} />}
          {v.cards?.map((c, i) => (
            <TouchableOpacity key={i} style={[card, { minHeight: 90, justifyContent: 'center' }]} onPress={() => setFlipped((f) => ({ ...f, [i]: !f[i] }))}>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>{flipped[i] ? 'Answer' : `Card ${i + 1} · tap to flip`}</Text>
              <Text style={{ color: colors.text, fontSize: 18, fontWeight: flipped[i] ? '400' : '600', marginTop: 4 }}>{flipped[i] ? c.a : c.q}</Text>
              {flipped[i] && <SourceChips nums={c.src} sources={v.sources} onOpen={openSource} colors={colors} />}
            </TouchableOpacity>
          ))}
          {v.quiz?.map((q, i) => (
            <View key={i} style={card}>
              <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>{i + 1}. {q.q}</Text>
              {q.options.map((o, j) => {
                const chosen = picked[i] === j;
                const show = picked[i] !== undefined;
                const right = j === q.answer;
                return (
                  <TouchableOpacity key={j} disabled={show} onPress={() => setPicked((p) => ({ ...p, [i]: j }))}
                    style={{ marginTop: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: show && right ? '#16A34A' : chosen ? colors.error : colors.border, backgroundColor: show && right ? 'rgba(22,163,74,0.12)' : 'transparent' }}>
                    <Text style={{ color: colors.text }}>{'ABCD'[j]}) {o}</Text>
                  </TouchableOpacity>
                );
              })}
              {picked[i] !== undefined && (
                <View>
                  <Text style={{ color: picked[i] === q.answer ? '#16A34A' : colors.error, marginTop: 8, fontWeight: '600' }}>{picked[i] === q.answer ? 'Correct' : `Answer: ${'ABCD'[q.answer]}`}</Text>
                  {!!q.why && <Text style={{ color: colors.textSecondary, marginTop: 2 }}>{q.why}</Text>}
                  <SourceChips nums={q.src} sources={v.sources} onOpen={openSource} colors={colors} />
                </View>
              )}
            </View>
          ))}
          {v.quiz && Object.keys(picked).length === v.quiz.length && (
            <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center', marginVertical: 8 }}>
              Score: {v.quiz.filter((q, i) => picked[i] === q.answer).length} / {v.quiz.length}
            </Text>
          )}
          {v.podcast && (
            <View>
              {(() => {
                const items = v.podcast!.map((l) => ({ text: l.text, ...castVoice(l.host, v.hosts ?? 2) }));
                return (
                  <MediaBar durations={items.map((x) => secs(x.text))} playing={playing} resumeAt={resumeAt} itemStart={itemStart} colors={colors}
                    onPlay={(i) => play(items, i, `${projectId}-${v.createdAt}`, v.storyStarts)} onPause={halt} label="podcast" />
                );
              })()}
              {v.podcast.map((l, i) => (
                <TouchableOpacity key={i} activeOpacity={0.8} onPress={() => play(v.podcast!.map((x) => ({ text: x.text, ...castVoice(x.host, v.hosts ?? 2) })), i, `${projectId}-${v.createdAt}`, v.storyStarts)}
                  style={[card, { borderLeftWidth: 4, borderLeftColor: l.host === 'A' ? '#2563EB' : l.host === 'B' ? '#D97706' : '#16A34A', opacity: playing === null || playing === i ? 1 : 0.55 }]}>
                  <Text style={{ color: colors.textMuted, fontSize: 12 }}>{(v.hosts ?? 2) === 1 ? 'Narrator' : `Host ${l.host}`}</Text>
                  <Text style={{ color: colors.text, fontSize: 16 }}>{l.text}</Text>
                </TouchableOpacity>
              ))}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
                <TouchableOpacity accessibilityRole="button" testID="export-briefing" onPress={() => { void saveBriefing(v, 'transcript'); }} style={{ flexDirection: 'row', alignItems: 'center', marginRight: 18, paddingVertical: 6 }}>
                  <Icon name="download" size={18} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontSize: 15, marginLeft: 8 }}>Export transcript</Text>
                </TouchableOpacity>
                {!!v.headlines?.length && (
                  <TouchableOpacity accessibilityRole="button" testID="export-briefing-summary" onPress={() => { void saveBriefing(v, 'summary'); }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
                    <Icon name="file-text" size={18} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontSize: 15, marginLeft: 8 }}>Export news summary</Text>
                  </TouchableOpacity>
                )}
              </View>
              <SourceChips nums={v.sources.map((s) => s.n)} sources={v.sources} onOpen={openSource} colors={colors} />
            </View>
          )}
          {v.slides && (
            <View>
              {(() => {
                const items = v.slides!.map((x) => ({ text: `${x.title}. ${x.narration}`, pitch: 1 }));
                return (
                  <MediaBar durations={items.map((x) => secs(x.text))} playing={playing} resumeAt={resumeAt} itemStart={itemStart} colors={colors}
                    onPlay={(i) => play(items, i)} onPause={halt} label="video" />
                );
              })()}
              <View style={[card, { marginTop: 4 }]}>
                <TouchableOpacity accessibilityRole="button" onPress={() => { void savePowerPoint(v); }} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Icon name="file-text" size={18} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontSize: 15, marginLeft: 8 }}>Save as PowerPoint (.pptx)</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>Made on this phone. You choose where it is saved, for example Downloads. Opens in PowerPoint, Google Slides and Keynote.</Text>
              </View>
              {videoExportAvailable() && (
                <View style={[card, { marginTop: 4 }]}>
                  {exporting ? (
                    <View>
                      <Text style={{ color: colors.text, fontSize: 14 }}>{stageText(exporting)}... {Math.round(exporting.fraction * 100)}%</Text>
                      <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.background, marginTop: 8 }}>
                        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.primary, width: `${Math.round(exporting.fraction * 100)}%` }} />
                      </View>
                      <TouchableOpacity onPress={cancelVideoExport} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
                        <Text style={{ color: colors.primary, fontSize: 14 }}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View>
                      <TouchableOpacity onPress={() => askSaveVideo(v.title || v.topic || 'Atlas video', v.slides!)} style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon name="download" size={18} color={colors.primary} />
                        <Text style={{ color: colors.primary, fontSize: 15, marginLeft: 8 }}>Save as video</Text>
                      </TouchableOpacity>
                      <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>Made on this phone, offline. Saved to Movies/Atlas as an MP4.</Text>
                      {savedVideo && (
                        <View style={{ marginTop: 10 }}>
                          <Text style={{ color: colors.text, fontSize: 14 }}>Saved: {savedVideo.name}</Text>
                          <View style={{ flexDirection: 'row', marginTop: 6 }}>
                            <TouchableOpacity onPress={() => { shareVideo(savedVideo.uri).catch(() => Alert.alert('Could not share the video')); }} style={{ marginRight: 20 }}>
                              <Text style={{ color: colors.primary, fontSize: 14 }}>Share</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => { openVideo(savedVideo.uri).catch(() => Alert.alert('No video player found')); }}>
                              <Text style={{ color: colors.primary, fontSize: 14 }}>Play</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}
              {(playing !== null ? [v.slides[playing]] : v.slides).map((s, i) => (
                <View key={i} style={[card, { minHeight: playing !== null ? Math.min(420, width * 0.7) : undefined, justifyContent: 'center', backgroundColor: playing !== null ? '#0F172A' : colors.surface }]}>
                  <Text style={{ color: playing !== null ? '#fff' : colors.text, fontSize: playing !== null ? 26 : 18, fontWeight: '700' }}>{s.title}</Text>
                  {s.bullets.map((b, j) => <Text key={j} style={{ color: playing !== null ? '#CBD5E1' : colors.textSecondary, fontSize: playing !== null ? 19 : 15, marginTop: 6 }}>• {b}</Text>)}
                  <SourceChips nums={s.src} sources={v.sources} onOpen={openSource} colors={colors} />
                </View>
              ))}
            </View>
          )}
        </ScrollView>
        {sourceModal}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      {header(`Study: ${project?.name || ''}`, () => navigation.goBack())}
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120, width: '100%', maxWidth: 920, alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 10 }}>
          Made from this project's documents by the AI on your phone. Every answer, card and question shows [numbers] - tap one to read the exact passage it came from.
        </Text>
        <TextInput value={topic} onChangeText={setTopic} placeholder="Topic or question (optional): e.g. treating burns"
          placeholderTextColor={colors.textMuted} style={{ backgroundColor: colors.surface, color: colors.text, borderRadius: 10, padding: 12, fontSize: 15 }} />
        <TouchableOpacity onPress={() => run('answer')} disabled={!!busy} style={{ backgroundColor: colors.primary, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 8 }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>{busy === 'Answering' ? 'Answering...' : 'Ask with sources'}</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, marginTop: 10 }}>
          {KINDS.filter(k => learningEnabled || !['quiz','podcast','crossword','wordsearch','match','practice','plan','rubric'].includes(k.kind)).map((k) => (
            <View key={k.kind} style={{ width: width >= 700 ? '33.3%' : '50%', padding: 5 }}>
              <TouchableOpacity disabled={!!busy} onPress={() => run(k.kind)} style={[card, { marginBottom: 0, minHeight: 84 }]}>
                <Icon name={k.icon} size={20} color={colors.primary} />
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 6 }}>{busy === k.label ? 'Making...' : k.label}</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{k.desc}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
        {learningEnabled && (
          <View>
            <Text style={{ color: colors.text, fontWeight: '700', marginTop: 18, marginBottom: 4, fontSize: 16 }}>Learning games</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginBottom: 6 }}>Every game is made from this project's documents (type a topic above to focus it). What you get wrong comes back in Review.</Text>
            <View style={[card, { flexDirection: 'row', alignItems: 'center' }]}>
              <Icon name="calendar" size={18} color={colors.primary} />
              <Text style={{ color: colors.text, marginLeft: 10, flex: 1 }}>
                Today: {dueCount} card{dueCount === 1 ? '' : 's'} due · streak {streak} day{streak === 1 ? '' : 's'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 }}>
              {PROJECT_GAMES.map((g) => (
                <View key={g.type} style={{ width: width >= 700 ? '33.3%' : '50%', padding: 5 }}>
                  <TouchableOpacity disabled={!!busy} onPress={() => runGame(g.type)} accessibilityRole="button" accessibilityLabel={`${g.label}. ${g.desc}`} style={[card, { marginBottom: 0, minHeight: 84 }]}>
                    <Icon name={g.icon} size={20} color={colors.primary} />
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 6 }}>{busy === g.label ? 'Making...' : g.label}</Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>{g.desc}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}
        {!learningEnabled && <TouchableOpacity onPress={() => navigation.navigate('ProjectEdit', { projectId })} style={{ padding: 12, borderRadius: 10, backgroundColor: colors.surface, marginTop: 10 }}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>Learning activities are off for this project</Text>
          <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Turn on Learning Activities in Project Settings to make source-based games, quizzes and podcasts from this project.</Text>
          <Text style={{ color: colors.primary, marginTop: 6 }}>Open project settings</Text>
        </TouchableOpacity>}
        {busy && <Text style={{ color: colors.textSecondary, marginTop: 10 }}>{/\.\.\.$/.test(busy) ? busy : 'Working on it'} - this can take a few minutes on a phone.</Text>}
        {busy && /^(Planning|Writing part)/.test(busy) && (
          <TouchableOpacity onPress={() => { stopEpisode.current = true; }} accessibilityRole="button" style={{ marginTop: 6, alignSelf: 'flex-start' }}>
            <Text style={{ color: colors.primary, fontSize: 14 }}>Stop and keep what is written</Text>
          </TouchableOpacity>
        )}
        {saved.length > 0 && <Text style={{ color: colors.text, fontWeight: '700', marginTop: 18, marginBottom: 6 }}>Saved</Text>}
        {saved.map((r) => (
          <TouchableOpacity key={r.createdAt} style={[card, { flexDirection: 'row', alignItems: 'center' }]} onPress={() => { setFlipped({}); setPicked({}); setResumeAt(0); setView(r); }}>
            <Icon name={(r.kind === 'game' ? PROJECT_GAMES.find((g) => g.type === r.game?.type)?.icon : KINDS.find((k) => k.kind === r.kind)?.icon) || 'message-circle'} size={18} color={colors.primary} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>{r.title ? `${r.kind === 'podcast' ? '🎙 ' : ''}${r.title}` : `${KINDS.find((k) => k.kind === r.kind)?.label || 'Answer'}${r.topic ? `: ${r.topic}` : ''}`}</Text>
              <Text style={{ color: colors.textMuted, fontSize: 12 }}>{new Date(r.createdAt).toLocaleString()}</Text>
            </View>
            <TouchableOpacity onPress={() => remove(projectId, r.createdAt)} style={{ padding: 6 }}><Icon name="trash-2" size={16} color={colors.textMuted} /></TouchableOpacity>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {sourceModal}
      <Modal visible={podOpen} transparent animationType="slide" onRequestClose={() => setPodOpen(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 18, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
            <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>New podcast episode</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 13, marginTop: 4 }}>Leave the prompt empty and it picks the episode itself from your sources.</Text>
            <TextInput value={pod.prompt} onChangeText={(t) => setPod((p) => ({ ...p, prompt: t }))} multiline
              placeholder="e.g. Explain how to purify water for a 10-year-old, with examples"
              placeholderTextColor={colors.textMuted}
              style={{ backgroundColor: colors.background, color: colors.text, borderRadius: 10, padding: 12, marginTop: 10, minHeight: 60 }} />
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 12 }}>ABOUT HOW LONG</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              {[3, 5, 10, 15, 20, 30, 45, 60].map((m) => (
                <TouchableOpacity key={m} onPress={() => setPod((p) => ({ ...p, minutes: m }))} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: pod.minutes === m ? colors.primary : colors.background }}>
                  <Text style={{ color: pod.minutes === m ? '#fff' : colors.text, fontSize: 13 }}>{m} min</Text>
                </TouchableOpacity>
              ))}
            </View>
            {pod.minutes >= 10 && <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>
              {pod.minutes >= 30
                ? `Writing ${pod.minutes} minutes takes roughly ${Math.round(pod.minutes * 0.6)}-${pod.minutes * 2} minutes on a phone, one part at a time. Keep Atlas open and plugged in. You can stop at any point and keep what is written.`
                : 'Longer episodes take several minutes to write on a phone.'}
            </Text>}
            {pod.minutes >= 30 && !!podcastContextWarning() && <Text style={{ color: colors.error, fontSize: 12, marginTop: 4 }}>{podcastContextWarning()}</Text>}
            {voices.length >= 2 && (
              <>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 12 }}>PEOPLE ({voices.length} voices installed)</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  {([1, 2, 3] as const).filter((n) => n <= Math.min(3, voices.length)).map((n) => (
                    <TouchableOpacity key={n} onPress={() => setPod((p) => ({ ...p, hosts: n }))} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: pod.hosts === n ? colors.primary : colors.background }}>
                      <Text style={{ color: pod.hosts === n ? '#fff' : colors.text, fontSize: 13 }}>{n === 1 ? 'Solo narrator' : `${n} hosts`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 12 }}>VOICES</Text>
                <PodcastVoicePicker hosts={pod.hosts} />
              </>
            )}
            <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 12 }}>STYLE</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              {([['casual', 'Casual'], ['deep', 'Deep dive'], ['debate', 'Debate'], ['interview', 'Interview'], ['beginner', 'For beginners']] as [PodcastStyle, string][]).map(([k, l]) => (
                <TouchableOpacity key={k} onPress={() => setPod((p) => ({ ...p, style: k }))} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: pod.style === k ? colors.primary : colors.background }}>
                  <Text style={{ color: pod.style === k ? '#fff' : colors.text, fontSize: 13 }}>{l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={{ color: colors.text, fontWeight: '600' }}>Extra research</Text>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>Also look in your offline library and, when online, the web. Extra sources are marked 📚 / 🌐.</Text>
              </View>
              <Switch value={pod.research} onValueChange={(v) => setPod((p) => ({ ...p, research: v }))} />
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity onPress={() => setPodOpen(false)} style={{ flex: 1, padding: 13, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                <Text style={{ color: colors.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={makeEpisode} style={{ flex: 2, padding: 13, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Make episode</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const fmtTime = (t: number) => { const s = Math.max(0, Math.round(t)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Player controls: play/pause, skip, a seek bar and elapsed / total time (times are estimates). */
const MediaBar: React.FC<{
  durations: number[]; playing: number | null; resumeAt: number; itemStart: number; colors: any;
  onPlay: (index: number) => void; onPause: () => void; label: string;
}> = ({ durations, playing, resumeAt, itemStart, colors, onPlay, onPause, label }) => {
  const [barW, setBarW] = useState(1);
  const total = durations.reduce((a, b) => a + b, 0);
  const idx = playing ?? resumeAt;
  const before = durations.slice(0, idx).reduce((a, b) => a + b, 0);
  const inItem = playing !== null ? Math.min(durations[idx] || 0, (Date.now() - itemStart) / 1000) : 0;
  const elapsed = Math.min(total, before + inItem);
  const seekTo = (x: number) => {
    const target = (Math.max(0, Math.min(barW, x)) / barW) * total;
    let acc = 0;
    for (let i = 0; i < durations.length; i++) { if (acc + durations[i] > target) { onPlay(i); return; } acc += durations[i]; }
    onPlay(durations.length - 1);
  };
  const btn = { padding: 10 };
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
        <TouchableOpacity style={btn} onPress={() => onPlay(Math.max(0, idx - 1))} accessibilityLabel="Back"><Icon name="skip-back" size={22} color={colors.text} /></TouchableOpacity>
        <TouchableOpacity onPress={() => (playing !== null ? onPause() : onPlay(resumeAt))} accessibilityLabel={playing !== null ? 'Pause' : 'Play'}
          style={{ width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={playing !== null ? 'pause' : 'play'} size={26} color={colors.background} />
        </TouchableOpacity>
        <TouchableOpacity style={btn} onPress={() => onPlay(Math.min(durations.length - 1, idx + 1))} accessibilityLabel="Next"><Icon name="skip-forward" size={22} color={colors.text} /></TouchableOpacity>
      </View>
      <View
        onLayout={(e) => setBarW(e.nativeEvent.layout.width || 1)}
        onStartShouldSetResponder={() => true}
        onResponderRelease={(e) => seekTo(e.nativeEvent.locationX)}
        style={{ height: 28, justifyContent: 'center', marginTop: 8 }}
      >
        <View pointerEvents="none" style={{ height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' }}>
          <View style={{ width: `${total ? (elapsed / total) * 100 : 0}%`, height: 6, backgroundColor: colors.primary }} />
        </View>
        <View pointerEvents="none" style={{ position: 'absolute', top: 6, left: Math.max(0, (total ? elapsed / total : 0) * barW - 8), width: 16, height: 16, borderRadius: 8, backgroundColor: colors.primary }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>{fmtTime(elapsed)}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>{label} · part {Math.min(idx + 1, durations.length)} of {durations.length}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>{fmtTime(total)}</Text>
      </View>
    </View>
  );
};

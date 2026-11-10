import React, { useRef, useState } from 'react';
import { StyleSheet, ActivityIndicator, Alert, BackHandler, Linking, ScrollView, Share, Text, TextInput, TouchableOpacity, View, Modal, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { useProjectStore } from '../stores';
import { MarkdownText } from '../components/MarkdownText';
import { PodcastVoicePicker } from '../components/PodcastVoicePicker';
import { castLine, playLine, playJingle, setPodcastSpeed, stopPodcastAudio } from '../atlasVoice/podcastAudio';
import { storyJumps, currentStory } from '../study/storyJumps';
import { resumeLine } from '../study/listenPosition';
import { playEpisode } from '../study/playEpisode';
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
const BACKGROUNDCOLOR_RGBA_0_0_0_0_5 = 'rgba(0,0,0,0.5)';
const FONTWEIGHT_400 = '400';
const FONTWEIGHT_600 = '600';
const BORDERCOLOR_16A34A = '#16A34A';
const BACKGROUNDCOLOR_RGBA_22_163_74_0_12 = 'rgba(22,163,74,0.12)';
const BACKGROUNDCOLOR_TRANSPARENT = 'transparent';
const COLOR_16A34A = '#16A34A';
const BORDERLEFTCOLOR_2563EB = '#2563EB';
const OPACITY_1 = 1;
const OPACITY_0_55 = 0.55;
const BACKGROUNDCOLOR_0F172A = '#0F172A';
const COLOR_FFF = '#fff';
const FONTSIZE_26 = 26;
const FONTSIZE_18 = 18;
const COLOR_CBD5E1 = '#CBD5E1';
const FONTSIZE_19 = 19;
const FONTSIZE_15 = 15;
const WIDTH_33_3 = '33.3%';
const WIDTH_50 = '50%';
const literalStyles = StyleSheet.create({
  s1: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  s2: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, marginRight: 6, marginTop: 4 },
  s3: { fontSize: 12 },
  s4: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1 },
  s5: { marginRight: 12 },
  s6: { fontSize: 18, fontWeight: '600', flex: 1 },
  s7: { flex: 1, backgroundColor: BACKGROUNDCOLOR_RGBA_0_0_0_0_5, justifyContent: 'center', padding: 20 },
  s8: { borderRadius: 12, padding: 16, maxHeight: '75%' },
  s9: { fontWeight: '700' },
  s10: { fontSize: 12, marginBottom: 8 },
  s11: { marginBottom: 8 },
  s12: { fontSize: 15, lineHeight: 22 },
  s13: { flex: 1 },
  s14: { padding: 16, paddingBottom: 120, width: '100%', maxWidth: 920, alignSelf: 'center' },
  s15: { flexDirection: 'row', marginTop: 12 },
  s16: { marginRight: 22 },
  s17: { fontSize: 14 },
  s18: { minHeight: 90, justifyContent: 'center' },
  s19: { fontSize: 18 },
  s20: { marginTop: 4 },
  s21: { fontSize: 16, fontWeight: '600' },
  s22: { marginTop: 8, padding: 10, borderRadius: 8, borderWidth: 1 },
  s23: { marginTop: 8, fontWeight: '600' },
  s24: { marginTop: 2 },
  s25: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginVertical: 8 },
  s26: { borderLeftWidth: 4 },
  s27: { fontSize: 16 },
  s28: { flexDirection: 'row', alignItems: 'center', marginRight: 18, paddingVertical: 6 },
  s29: { fontSize: 15, marginLeft: 8 },
  s30: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  s31: { flexDirection: 'row', alignItems: 'center' },
  s32: { fontSize: 12, marginTop: 4 },
  s33: { height: 6, borderRadius: 3 },
  s34: { marginTop: 8 },
  s35: { marginTop: 10, alignSelf: 'flex-start' },
  s36: { marginTop: 10 },
  s37: { flexDirection: 'row', marginTop: 6 },
  s38: { marginRight: 20 },
  s39: { justifyContent: 'center' },
  s40: { marginTop: 6 },
  s41: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  s42: { borderRadius: 10, padding: 12, fontSize: 15 },
  s43: { borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 8 },
  s44: { color: COLOR_FFF, fontWeight: '600' },
  s45: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5, marginTop: 10 },
  s46: { padding: 5 },
  s47: { marginBottom: 0, minHeight: 84 },
  s48: { fontSize: 15, fontWeight: '600', marginTop: 6 },
  s49: { fontWeight: '700', marginTop: 18, marginBottom: 4, fontSize: 16 },
  s50: { fontSize: 12, marginBottom: 6 },
  s51: { marginLeft: 10, flex: 1 },
  s52: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  s53: { padding: 12, borderRadius: 10 },
  s54: { fontWeight: '600' },
  s55: { marginTop: 6, alignSelf: 'flex-start' },
  s56: { fontWeight: '700', marginTop: 18, marginBottom: 6 },
  s57: { flex: 1, marginLeft: 10 },
  s58: { padding: 6 },
  s59: { flex: 1, backgroundColor: BACKGROUNDCOLOR_RGBA_0_0_0_0_5, justifyContent: 'flex-end' },
  s60: { borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 18, width: '100%', maxWidth: 720, alignSelf: 'center' },
  s61: { fontSize: 18, fontWeight: '700' },
  s62: { fontSize: 13, marginTop: 4 },
  s63: { borderRadius: 10, padding: 12, marginTop: 10, minHeight: 60 },
  s64: { fontSize: 12, marginTop: 12 },
  s65: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  s66: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
  s67: { fontSize: 13 },
  s68: { flexDirection: 'row', gap: 8, marginTop: 6 },
  s69: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  s70: { flex: 1, paddingRight: 10 },
  s71: { flexDirection: 'row', gap: 10, marginTop: 16 },
  s72: { flex: 1, padding: 13, borderRadius: 10, borderWidth: 1 },
  s73: { alignItems: 'center' },
  s74: { flex: 2, padding: 13, borderRadius: 10 },
  s75: { color: COLOR_FFF, fontWeight: '700' },
  s76: { borderRadius: 12, padding: 12, marginBottom: 12 },
  s77: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18 },
  s78: { width: 58, height: 58, borderRadius: 29 },
  s79: { alignItems: 'center', justifyContent: 'center' },
  s80: { height: 28, justifyContent: 'center', marginTop: 8 },
  s81: { overflow: 'hidden' },
  s82: { height: 6 },
  s83: { position: 'absolute', top: 6 },
  s84: { width: 16, height: 16, borderRadius: 8 },
  s85: { flexDirection: 'row', justifyContent: 'space-between' },
});


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
    <View style={literalStyles.s1}>
      {list.map((s) => (
        <TouchableOpacity key={s.n} onPress={() => onOpen(s)} style={[{ backgroundColor: colors.background }, literalStyles.s2]}>
          <Text style={[{ color: colors.primary }, literalStyles.s3]}>[{s.n}] {s.origin === 'web' ? '🌐 ' : s.origin === 'library' ? '📚 ' : ''}{s.doc.replace(/\.(md|txt|pdf)$/i, '').slice(0, 28)}</Text>
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
  const [resumeAt, setResumeAt] = useState(() => {
    const r = openAt ? (useStudyStore.getState().saved[projectId] || []).find((x) => x.createdAt === openAt) : undefined;
    return r?.podcast ? resumeLine(useBriefPrefs.getState().listened, `${projectId}-${r.createdAt}`, r.podcast.length) : 0;
  });
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
      const r = await generateGame(projectId, type, { topic, onStep: (m) => setBusy(m) });
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

  /** Plays from line `from`. A podcast (with `source`) plays from pre-rendered audio files; the daily briefing also has tunes. */
  const play = async (items: { text: string; pitch: number; voice?: string }[], from = 0, source?: { audioKey: string; storyStarts: number[] }) => {
    const my = ++playToken.current;
    stop();
    stopPodcastAudio(); // a line playing from a file would otherwise play on top of the new one
    stopRef.current = false;
    keepScreenOn(true);
    let finished = false;
    const prefs = useBriefPrefs.getState();
    const audioKey = source?.audioKey;
    const isBrief = !!audioKey && audioKey.startsWith(`${BRIEF_PROJECT}-`);
    setPodcastSpeed(isBrief ? prefs.speed ?? 1 : 1);
    try {
      finished = await playEpisode({ count: items.length, from, tunes: isBrief && prefs.jingles !== false ? { storyStarts: source!.storyStarts } : undefined }, {
        stopped: () => stopRef.current || playToken.current !== my,
        jingle: (kind) => playJingle(kind, prefs.jingleVolume ?? 'normal'),
        onLine: (i) => {
          setPlaying(i); setResumeAt(i); setItemStart(Date.now());
          if (isBrief) useBriefPrefs.getState().set({ listened: { key: audioKey!, line: i } });
        },
        line: (i) => (audioKey ? playLine(audioKey, items, i) : speakAndWait(items[i].text, { pitch: items[i].pitch, voice: items[i].voice || '' })),
      });
    } catch (e: any) {
      Alert.alert('Playback stopped', String(e?.message || e));
    }
    if (playToken.current !== my) return; // a newer play (seek) took over
    keepScreenOn(false);
    setPlaying(null);
    if (finished) { setResumeAt(0); if (isBrief) useBriefPrefs.getState().set({ listened: null }); }
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
      const name = await savePptx(safeFileName(title, 'pptx'), title, deckSlides(title, r.topic && r.topic !== title ? r.topic : '', { slides: r.slides ?? [], sources: r.sources }));
      if (name) Alert.alert('Saved', name);
    } catch (e: any) { Alert.alert('Could not save the PowerPoint', String(e?.message || e)); }
  };
  const openSource = (s: Source) => setSrc(s);
  const card = { backgroundColor: colors.surface, borderRadius: 10, padding: 14, marginBottom: 10 };

  const header = (title: string, back: () => void) => (
    <View style={[literalStyles.s4, { borderBottomColor: colors.border }]}>
      <TouchableOpacity onPress={back} style={literalStyles.s5}><Icon name="arrow-left" size={20} color={colors.text} /></TouchableOpacity>
      <Text style={[{ color: colors.text }, literalStyles.s6]} numberOfLines={1}>{title}</Text>
      {busy && <ActivityIndicator color={colors.primary} />}
    </View>
  );

  const sourceModal = (
    <Modal visible={!!src} transparent animationType="fade" onRequestClose={() => setSrc(null)}>
      <TouchableOpacity activeOpacity={1} onPress={() => setSrc(null)} style={literalStyles.s7}>
        <View style={[{ backgroundColor: colors.surface }, literalStyles.s8]}>
          <Text style={[{ color: colors.primary }, literalStyles.s9]}>Source [{src?.n}]</Text>
          <Text style={[{ color: colors.textSecondary }, literalStyles.s10]}>{src?.doc} · part {src?.part}</Text>
          {!!src?.url && (
            <TouchableOpacity onPress={() => Linking.openURL(src.url!).catch(() => undefined)} style={literalStyles.s11}>
              <Text style={{ color: colors.primary }}>Open the full article (needs internet)</Text>
            </TouchableOpacity>
          )}
          <ScrollView><Text style={[{ color: colors.text }, literalStyles.s12]}>{src?.text}</Text></ScrollView>
        </View>
      </TouchableOpacity>
    </Modal>
  );

  if (view) {
    const v = view;
    return (
      <SafeAreaView style={[literalStyles.s13, { backgroundColor: colors.background }]} edges={['top']}>
        {header(v.title || `${KINDS.find((k) => k.kind === v.kind)?.label || 'Answer'}${v.topic ? `: ${v.topic}` : ''}`, () => { halt(); if (openAt) navigation.goBack(); else setView(null); })}
        <ScrollView contentContainerStyle={literalStyles.s14}>
          {!!v.text && (
            <View style={card}>
              <MarkdownText>{v.text}</MarkdownText>
              <SourceChips nums={[...new Set([...v.text.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])))]} sources={v.sources} onOpen={openSource} colors={colors} />
              <View style={literalStyles.s15}>
                <TouchableOpacity accessibilityRole="button" onPress={() => { void shareText(v); }} style={literalStyles.s16}>
                  <Text style={[{ color: colors.primary }, literalStyles.s17]}>Share</Text>
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" onPress={() => { void saveText(v); }}>
                  <Text style={[{ color: colors.primary }, literalStyles.s17]}>Save as file (Markdown)</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {v.kind !== 'game' && (v.crossword || v.wordSearch || v.learningTerms) && <ProjectLearningGame key={v.createdAt} activity={v} onOpenSource={openSource} />}
          {v.kind === 'game' && <ProjectGame key={v.createdAt} result={v} projectId={projectId} onOpenSource={openSource} />}
          {v.cards?.map((c, i) => (
            <TouchableOpacity key={i} style={[card, literalStyles.s18]} onPress={() => setFlipped((f) => ({ ...f, [i]: !f[i] }))}>
              <Text style={[{ color: colors.textMuted }, literalStyles.s3]}>{flipped[i] ? 'Answer' : `Card ${i + 1} · tap to flip`}</Text>
              <Text style={[{ color: colors.text }, literalStyles.s19, { fontWeight: flipped[i] ? FONTWEIGHT_400 : FONTWEIGHT_600 }, literalStyles.s20]}>{flipped[i] ? c.a : c.q}</Text>
              {flipped[i] && <SourceChips nums={c.src} sources={v.sources} onOpen={openSource} colors={colors} />}
            </TouchableOpacity>
          ))}
          {v.quiz?.map((q, i) => (
            <View key={i} style={card}>
              <Text style={[{ color: colors.text }, literalStyles.s21]}>{i + 1}. {q.q}</Text>
              {q.options.map((o, j) => {
                const chosen = picked[i] === j;
                const show = picked[i] !== undefined;
                const right = j === q.answer;
                return (
                  <TouchableOpacity key={j} disabled={show} onPress={() => setPicked((p) => ({ ...p, [i]: j }))}
                    style={[literalStyles.s22, { borderColor: show && right ? BORDERCOLOR_16A34A : chosen ? colors.error : colors.border, backgroundColor: show && right ? BACKGROUNDCOLOR_RGBA_22_163_74_0_12 : BACKGROUNDCOLOR_TRANSPARENT }]}>
                    <Text style={{ color: colors.text }}>{'ABCD'[j]}) {o}</Text>
                  </TouchableOpacity>
                );
              })}
              {picked[i] !== undefined && (
                <View>
                  <Text style={[{ color: picked[i] === q.answer ? COLOR_16A34A : colors.error }, literalStyles.s23]}>{picked[i] === q.answer ? 'Correct' : `Answer: ${'ABCD'[q.answer]}`}</Text>
                  {!!q.why && <Text style={[{ color: colors.textSecondary }, literalStyles.s24]}>{q.why}</Text>}
                  <SourceChips nums={q.src} sources={v.sources} onOpen={openSource} colors={colors} />
                </View>
              )}
            </View>
          ))}
          {v.quiz && Object.keys(picked).length === v.quiz.length && (
            <Text style={[{ color: colors.text }, literalStyles.s25]}>
              Score: {v.quiz.filter((q, i) => picked[i] === q.answer).length} / {v.quiz.length}
            </Text>
          )}
          {v.podcast && (
            <View>
              {(() => {
                const items = v.podcast!.map((l) => ({ text: l.text, ...castVoice(l.host, v.hosts ?? 2) }));
                return (
                  <MediaBar durations={items.map((x) => secs(x.text))} playing={playing} resumeAt={resumeAt} itemStart={itemStart} colors={colors}
                    onPlay={(i) => play(items, i, { audioKey: `${projectId}-${v.createdAt}`, storyStarts: v.storyStarts ?? [] })} onPause={halt} label="podcast" />
                );
              })()}
              {(() => {
                const jumps = storyJumps(v);
                if (!jumps.length) return null;
                const now = currentStory(jumps, playing ?? resumeAt);
                return (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={jumpStyles.row} testID="story-jumps">
                    {jumps.map((j, k) => (
                      <TouchableOpacity key={`${j.line}-${j.label}`} testID={`story-jump-${k}`} accessibilityRole="button" accessibilityLabel={`Play story ${k + 1}: ${j.label}`}
                        onPress={() => play(v.podcast!.map((x) => ({ text: x.text, ...castVoice(x.host, v.hosts ?? 2) })), j.line, { audioKey: `${projectId}-${v.createdAt}`, storyStarts: v.storyStarts ?? [] })}
                        style={[jumpStyles.chip, { backgroundColor: k === now ? colors.primary : colors.surface }]}>
                        <Text style={[jumpStyles.text, { color: k === now ? colors.background : colors.text }]}>{k + 1}. {j.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                );
              })()}
              {v.podcast.map((l, i) => (
                <TouchableOpacity key={i} activeOpacity={0.8} onPress={() => play(v.podcast!.map((x) => ({ text: x.text, ...castVoice(x.host, v.hosts ?? 2) })), i, { audioKey: `${projectId}-${v.createdAt}`, storyStarts: v.storyStarts ?? [] })}
                  style={[card, [literalStyles.s26, { borderLeftColor: l.host === 'A' ? BORDERLEFTCOLOR_2563EB : l.host === 'B' ? '#D97706' : '#16A34A', opacity: playing === null || playing === i ? OPACITY_1 : OPACITY_0_55 }]]}>
                  <Text style={[{ color: colors.textMuted }, literalStyles.s3]}>{(v.hosts ?? 2) === 1 ? 'Narrator' : `Host ${l.host}`}</Text>
                  <Text style={[{ color: colors.text }, literalStyles.s27]}>{l.text}</Text>
                </TouchableOpacity>
              ))}
              <View style={literalStyles.s1}>
                <TouchableOpacity accessibilityRole="button" testID="export-briefing" onPress={() => { void saveBriefing(v, 'transcript'); }} style={literalStyles.s28}>
                  <Icon name="download" size={18} color={colors.primary} />
                  <Text style={[{ color: colors.primary }, literalStyles.s29]}>Export transcript</Text>
                </TouchableOpacity>
                {!!v.headlines?.length && (
                  <TouchableOpacity accessibilityRole="button" testID="export-briefing-summary" onPress={() => { void saveBriefing(v, 'summary'); }} style={literalStyles.s30}>
                    <Icon name="file-text" size={18} color={colors.primary} />
                    <Text style={[{ color: colors.primary }, literalStyles.s29]}>Export news summary</Text>
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
              <View style={[card, literalStyles.s20]}>
                <TouchableOpacity accessibilityRole="button" onPress={() => { void savePowerPoint(v); }} style={literalStyles.s31}>
                  <Icon name="file-text" size={18} color={colors.primary} />
                  <Text style={[{ color: colors.primary }, literalStyles.s29]}>Save as PowerPoint (.pptx)</Text>
                </TouchableOpacity>
                <Text style={[{ color: colors.textMuted }, literalStyles.s32]}>Made on this phone. You choose where it is saved, for example Downloads. Opens in PowerPoint, Google Slides and Keynote.</Text>
              </View>
              {videoExportAvailable() && (
                <View style={[card, literalStyles.s20]}>
                  {exporting ? (
                    <View>
                      <Text style={[{ color: colors.text }, literalStyles.s17]}>{stageText(exporting)}... {Math.round(exporting.fraction * 100)}%</Text>
                      <View style={[literalStyles.s33, { backgroundColor: colors.background }, literalStyles.s34]}>
                        <View style={[literalStyles.s33, { backgroundColor: colors.primary, width: `${Math.round(exporting.fraction * 100)}%` }]} />
                      </View>
                      <TouchableOpacity onPress={cancelVideoExport} style={literalStyles.s35}>
                        <Text style={[{ color: colors.primary }, literalStyles.s17]}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View>
                      <TouchableOpacity onPress={() => askSaveVideo(v.title || v.topic || 'Atlas video', v.slides!)} style={literalStyles.s31}>
                        <Icon name="download" size={18} color={colors.primary} />
                        <Text style={[{ color: colors.primary }, literalStyles.s29]}>Save as video</Text>
                      </TouchableOpacity>
                      <Text style={[{ color: colors.textMuted }, literalStyles.s32]}>Made on this phone, offline. Saved to Movies/Atlas as an MP4.</Text>
                      {savedVideo && (
                        <View style={literalStyles.s36}>
                          <Text style={[{ color: colors.text }, literalStyles.s17]}>Saved: {savedVideo.name}</Text>
                          <View style={literalStyles.s37}>
                            <TouchableOpacity onPress={() => { shareVideo(savedVideo.uri).catch(() => Alert.alert('Could not share the video')); }} style={literalStyles.s38}>
                              <Text style={[{ color: colors.primary }, literalStyles.s17]}>Share</Text>
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => { openVideo(savedVideo.uri).catch(() => Alert.alert('No video player found')); }}>
                              <Text style={[{ color: colors.primary }, literalStyles.s17]}>Play</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )}
              {(playing !== null ? [v.slides[playing]] : v.slides).map((s, i) => (
                <View key={i} style={[card, [{ minHeight: playing !== null ? Math.min(420, width * 0.7) : undefined }, literalStyles.s39, { backgroundColor: playing !== null ? BACKGROUNDCOLOR_0F172A : colors.surface }]]}>
                  <Text style={[{ color: playing !== null ? COLOR_FFF : colors.text, fontSize: playing !== null ? FONTSIZE_26 : FONTSIZE_18 }, literalStyles.s9]}>{s.title}</Text>
                  {s.bullets.map((b, j) => <Text key={j} style={[{ color: playing !== null ? COLOR_CBD5E1 : colors.textSecondary, fontSize: playing !== null ? FONTSIZE_19 : FONTSIZE_15 }, literalStyles.s40]}>• {b}</Text>)}
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
    <SafeAreaView style={[literalStyles.s13, { backgroundColor: colors.background }]} edges={['top']}>
      {header(`Study: ${project?.name || ''}`, () => navigation.goBack())}
      <ScrollView contentContainerStyle={literalStyles.s14} keyboardShouldPersistTaps="handled">
        <Text style={[{ color: colors.textSecondary }, literalStyles.s41]}>
          Made from this project's documents by the AI on your phone. Every answer, card and question shows [numbers] - tap one to read the exact passage it came from.
        </Text>
        <TextInput value={topic} onChangeText={setTopic} placeholder="Topic or question (optional): e.g. treating burns"
          placeholderTextColor={colors.textMuted} style={[{ backgroundColor: colors.surface, color: colors.text }, literalStyles.s42]} />
        <TouchableOpacity onPress={() => run('answer')} disabled={!!busy} style={[{ backgroundColor: colors.primary }, literalStyles.s43]}>
          <Text style={literalStyles.s44}>{busy === 'Answering' ? 'Answering...' : 'Ask with sources'}</Text>
        </TouchableOpacity>
        <View style={literalStyles.s45}>
          {KINDS.filter(k => learningEnabled || !['quiz','podcast','crossword','wordsearch','match','practice','plan','rubric'].includes(k.kind)).map((k) => (
            <View key={k.kind} style={[{ width: width >= 700 ? WIDTH_33_3 : WIDTH_50 }, literalStyles.s46]}>
              <TouchableOpacity disabled={!!busy} onPress={() => run(k.kind)} style={[card, literalStyles.s47]}>
                <Icon name={k.icon} size={20} color={colors.primary} />
                <Text style={[{ color: colors.text }, literalStyles.s48]}>{busy === k.label ? 'Making...' : k.label}</Text>
                <Text style={[{ color: colors.textSecondary }, literalStyles.s3]}>{k.desc}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
        {learningEnabled && (
          <View>
            <Text style={[{ color: colors.text }, literalStyles.s49]}>Learning games</Text>
            <Text style={[{ color: colors.textSecondary }, literalStyles.s50]}>Every game is made from this project's documents (type a topic above to focus it). What you get wrong comes back in Review.</Text>
            <View style={[card, literalStyles.s31]}>
              <Icon name="calendar" size={18} color={colors.primary} />
              <Text style={[{ color: colors.text }, literalStyles.s51]}>
                Today: {dueCount} card{dueCount === 1 ? '' : 's'} due · streak {streak} day{streak === 1 ? '' : 's'}
              </Text>
            </View>
            <View style={literalStyles.s52}>
              {PROJECT_GAMES.map((g) => (
                <View key={g.type} style={[{ width: width >= 700 ? WIDTH_33_3 : WIDTH_50 }, literalStyles.s46]}>
                  <TouchableOpacity disabled={!!busy} onPress={() => runGame(g.type)} accessibilityRole="button" accessibilityLabel={`${g.label}. ${g.desc}`} style={[card, literalStyles.s47]}>
                    <Icon name={g.icon} size={20} color={colors.primary} />
                    <Text style={[{ color: colors.text }, literalStyles.s48]}>{busy === g.label ? 'Making...' : g.label}</Text>
                    <Text style={[{ color: colors.textSecondary }, literalStyles.s3]}>{g.desc}</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        )}
        {!learningEnabled && <TouchableOpacity onPress={() => navigation.navigate('ProjectEdit', { projectId })} style={[literalStyles.s53, { backgroundColor: colors.surface }, literalStyles.s36]}>
          <Text style={[{ color: colors.text }, literalStyles.s54]}>Learning activities are off for this project</Text>
          <Text style={[{ color: colors.textSecondary }, literalStyles.s3]}>Turn on Learning Activities in Project Settings to make source-based games, quizzes and podcasts from this project.</Text>
          <Text style={[{ color: colors.primary }, literalStyles.s40]}>Open project settings</Text>
        </TouchableOpacity>}
        {busy && <Text style={[{ color: colors.textSecondary }, literalStyles.s36]}>{/\.\.\.$/.test(busy) ? busy : 'Working on it'} - this can take a few minutes on a phone.</Text>}
        {busy && /^(Planning|Writing part)/.test(busy) && (
          <TouchableOpacity onPress={() => { stopEpisode.current = true; }} accessibilityRole="button" style={literalStyles.s55}>
            <Text style={[{ color: colors.primary }, literalStyles.s17]}>Stop and keep what is written</Text>
          </TouchableOpacity>
        )}
        {saved.length > 0 && <Text style={[{ color: colors.text }, literalStyles.s56]}>Saved</Text>}
        {saved.map((r) => (
          <TouchableOpacity key={r.createdAt} style={[card, literalStyles.s31]} onPress={() => { setFlipped({}); setPicked({}); setResumeAt(0); setView(r); }}>
            <Icon name={(r.kind === 'game' ? PROJECT_GAMES.find((g) => g.type === r.game?.type)?.icon : KINDS.find((k) => k.kind === r.kind)?.icon) || 'message-circle'} size={18} color={colors.primary} />
            <View style={literalStyles.s57}>
              <Text style={[{ color: colors.text }, literalStyles.s54]}>{r.title ? `${r.kind === 'podcast' ? '🎙 ' : ''}${r.title}` : `${KINDS.find((k) => k.kind === r.kind)?.label || 'Answer'}${r.topic ? `: ${r.topic}` : ''}`}</Text>
              <Text style={[{ color: colors.textMuted }, literalStyles.s3]}>{new Date(r.createdAt).toLocaleString()}</Text>
            </View>
            <TouchableOpacity onPress={() => remove(projectId, r.createdAt)} style={literalStyles.s58}><Icon name="trash-2" size={16} color={colors.textMuted} /></TouchableOpacity>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {sourceModal}
      <Modal visible={podOpen} transparent animationType="slide" onRequestClose={() => setPodOpen(false)}>
        <View style={literalStyles.s59}>
          <View style={[{ backgroundColor: colors.surface }, literalStyles.s60]}>
            <Text style={[{ color: colors.text }, literalStyles.s61]}>New podcast episode</Text>
            <Text style={[{ color: colors.textSecondary }, literalStyles.s62]}>Leave the prompt empty and it picks the episode itself from your sources.</Text>
            <TextInput value={pod.prompt} onChangeText={(t) => setPod((p) => ({ ...p, prompt: t }))} multiline
              placeholder="e.g. Explain how to purify water for a 10-year-old, with examples"
              placeholderTextColor={colors.textMuted}
              style={[{ backgroundColor: colors.background, color: colors.text }, literalStyles.s63]} />
            <Text style={[{ color: colors.textSecondary }, literalStyles.s64]}>ABOUT HOW LONG</Text>
            <View style={literalStyles.s65}>
              {[3, 5, 10, 15, 20, 30, 45, 60].map((m) => (
                <TouchableOpacity key={m} onPress={() => setPod((p) => ({ ...p, minutes: m }))} style={[literalStyles.s66, { backgroundColor: pod.minutes === m ? colors.primary : colors.background }]}>
                  <Text style={[{ color: pod.minutes === m ? COLOR_FFF : colors.text }, literalStyles.s67]}>{m} min</Text>
                </TouchableOpacity>
              ))}
            </View>
            {pod.minutes >= 10 && <Text style={[{ color: colors.textMuted }, literalStyles.s32]}>
              {pod.minutes >= 30
                ? `Writing ${pod.minutes} minutes takes roughly ${Math.round(pod.minutes * 0.6)}-${pod.minutes * 2} minutes on a phone, one part at a time. Keep Atlas open and plugged in. You can stop at any point and keep what is written.`
                : 'Longer episodes take several minutes to write on a phone.'}
            </Text>}
            {pod.minutes >= 30 && !!podcastContextWarning() && <Text style={[{ color: colors.error }, literalStyles.s32]}>{podcastContextWarning()}</Text>}
            {voices.length >= 2 && (
              <>
                <Text style={[{ color: colors.textSecondary }, literalStyles.s64]}>PEOPLE ({voices.length} voices installed)</Text>
                <View style={literalStyles.s68}>
                  {([1, 2, 3] as const).filter((n) => n <= Math.min(3, voices.length)).map((n) => (
                    <TouchableOpacity key={n} onPress={() => setPod((p) => ({ ...p, hosts: n }))} style={[literalStyles.s66, { backgroundColor: pod.hosts === n ? colors.primary : colors.background }]}>
                      <Text style={[{ color: pod.hosts === n ? COLOR_FFF : colors.text }, literalStyles.s67]}>{n === 1 ? 'Solo narrator' : `${n} hosts`}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={[{ color: colors.textSecondary }, literalStyles.s64]}>VOICES</Text>
                <PodcastVoicePicker hosts={pod.hosts} />
              </>
            )}
            <Text style={[{ color: colors.textSecondary }, literalStyles.s64]}>STYLE</Text>
            <View style={literalStyles.s65}>
              {([['casual', 'Casual'], ['deep', 'Deep dive'], ['debate', 'Debate'], ['interview', 'Interview'], ['beginner', 'For beginners']] as [PodcastStyle, string][]).map(([k, l]) => (
                <TouchableOpacity key={k} onPress={() => setPod((p) => ({ ...p, style: k }))} style={[literalStyles.s66, { backgroundColor: pod.style === k ? colors.primary : colors.background }]}>
                  <Text style={[{ color: pod.style === k ? COLOR_FFF : colors.text }, literalStyles.s67]}>{l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={literalStyles.s69}>
              <View style={literalStyles.s70}>
                <Text style={[{ color: colors.text }, literalStyles.s54]}>Extra research</Text>
                <Text style={[{ color: colors.textSecondary }, literalStyles.s3]}>Also look in your offline library and, when online, the web. Extra sources are marked 📚 / 🌐.</Text>
              </View>
              <Switch value={pod.research} onValueChange={(v) => setPod((p) => ({ ...p, research: v }))} />
            </View>
            <View style={literalStyles.s71}>
              <TouchableOpacity onPress={() => setPodOpen(false)} style={[literalStyles.s72, { borderColor: colors.border }, literalStyles.s73]}>
                <Text style={{ color: colors.text }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={makeEpisode} style={[literalStyles.s74, { backgroundColor: colors.primary }, literalStyles.s73]}>
                <Text style={literalStyles.s75}>Make episode</Text>
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
    <View style={[{ backgroundColor: colors.surface }, literalStyles.s76]}>
      <View style={literalStyles.s77}>
        <TouchableOpacity style={btn} onPress={() => onPlay(Math.max(0, idx - 1))} accessibilityLabel="Back"><Icon name="skip-back" size={22} color={colors.text} /></TouchableOpacity>
        <TouchableOpacity onPress={() => (playing !== null ? onPause() : onPlay(resumeAt))} accessibilityLabel={playing !== null ? 'Pause' : 'Play'}
          style={[literalStyles.s78, { backgroundColor: colors.primary }, literalStyles.s79]}>
          <Icon name={playing !== null ? 'pause' : 'play'} size={26} color={colors.background} />
        </TouchableOpacity>
        <TouchableOpacity style={btn} onPress={() => onPlay(Math.min(durations.length - 1, idx + 1))} accessibilityLabel="Next"><Icon name="skip-forward" size={22} color={colors.text} /></TouchableOpacity>
      </View>
      <View
        onLayout={(e) => setBarW(e.nativeEvent.layout.width || 1)}
        onStartShouldSetResponder={() => true}
        onResponderRelease={(e) => seekTo(e.nativeEvent.locationX)}
        style={literalStyles.s80}
      >
        <View pointerEvents="none" style={[literalStyles.s33, { backgroundColor: colors.border }, literalStyles.s81]}>
          <View style={[{ width: `${total ? (elapsed / total) * 100 : 0}%` }, literalStyles.s82, { backgroundColor: colors.primary }]} />
        </View>
        <View pointerEvents="none" style={[literalStyles.s83, { left: Math.max(0, (total ? elapsed / total : 0) * barW - 8) }, literalStyles.s84, { backgroundColor: colors.primary }]} />
      </View>
      <View style={literalStyles.s85}>
        <Text style={[{ color: colors.textMuted }, literalStyles.s3]}>{fmtTime(elapsed)}</Text>
        <Text style={[{ color: colors.textMuted }, literalStyles.s3]}>{label} · part {Math.min(idx + 1, durations.length)} of {durations.length}</Text>
        <Text style={[{ color: colors.textMuted }, literalStyles.s3]}>{fmtTime(total)}</Text>
      </View>
    </View>
  );
};

const jumpStyles = StyleSheet.create({ row: { marginBottom: 10 }, chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, marginRight: 8 }, text: { fontSize: 13 } });

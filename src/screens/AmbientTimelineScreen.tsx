/**
 * The ambient timeline — the product surface for the 24/7 recorder.
 *
 * Not the transcript: a scannable feed of your day, one card per conversation, each a title + one-line
 * headline + the few things that matter (decisions, actions, people). Capture lives at the top (one
 * control, always-visible recording state for consent); on stop the capture is sessionized,
 * transcribed, and summarised on-device, and its cards drop into the feed. Tap a card for the detail.
 *
 * Terminal/brutalist, Menlo, emerald: dense rows, sharp borders, an emerald pulse while recording. The
 * store is the source of truth; this reads it and renders days newest-first.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Animated
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { triggerHaptic } from '../utils/haptics';
import { createAmbientRecorder } from '../services/ambient/ambientRecorderFactory';
import { ensureAmbientSliceDir } from '../services/ambient/phoneSttExecutorFactory';
import { createDefaultTimelineBuildDeps } from '../services/ambient/timelineBuilderFactory';
import { buildTimelineSessions, type BuildProgress } from '../services/ambient/timelineBuilder';
import { groupSessionsByDay, type TimelineSession } from '../services/ambient/timelineModel';
import { summaryStatusHint } from '../services/ambient/summarizer';
import { askDayWithDeviceLLM } from '../services/ambient/askDayFactory';
import type { AskResult } from '../services/ambient/askDay';
import { useAmbientTimelineStore } from '../stores/ambientTimelineStore';
import { mobileSpeechInputPorts } from '../services/adapters/speech/mobileSpeechInputPorts';
import type { AmbientRecorder } from '../services/ambient/ambientRecorder';
import type { SpeechSegment } from '../services/ambient/vadSegmenter';

type Phase = 'idle' | 'recording' | 'processing';

export function AmbientTimelineScreen(): React.ReactElement {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation<any>();
  const sessions = useAmbientTimelineStore(s => s.sessions);
  const onDeviceOnly = useAmbientTimelineStore(s => s.onDeviceOnly);
  const setOnDeviceOnly = useAmbientTimelineStore(s => s.setOnDeviceOnly);

  const recorderRef = useRef<AmbientRecorder | null>(null);
  const segmentsRef = useRef<SpeechSegment[]>([]);
  const startedAtRef = useRef<number>(0);
  const anchorsRef = useRef<number[]>([]);
  const [flagCount, setFlagCount] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [liveCount, setLiveCount] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [progress, setProgress] = useState<BuildProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [askQuery, setAskQuery] = useState('');
  const [asking, setAsking] = useState(false);
  const [askResult, setAskResult] = useState<AskResult | null>(null);

  const ask = useCallback(async () => {
    const question = askQuery.trim();
    if (question.length === 0 || asking) {
      return;
    }
    setAsking(true);
    setAskResult(null);
    try {
      const result = await askDayWithDeviceLLM(
        question,
        useAmbientTimelineStore.getState().sessions,
        formatClock,
        useAmbientTimelineStore.getState().onDeviceOnly
      );
      setAskResult(result);
    } finally {
      setAsking(false);
    }
  }, [askQuery, asking]);

  // Recording elapsed timer, for the always-visible REC 0:42 (consent + feedback).
  useEffect(() => {
    if (phase !== 'recording') {
      return;
    }
    const startedAt = startedAtRef.current;
    setElapsedMs(Date.now() - startedAt);
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [phase]);

  const flag = useCallback(() => {
    if (phase !== 'recording') {
      return;
    }
    anchorsRef.current = [...anchorsRef.current, Date.now() - startedAtRef.current];
    setFlagCount(anchorsRef.current.length);
    triggerHaptic('impactMedium');
  }, [phase]);

  const start = useCallback(async () => {
    setError(null);
    setLiveCount(0);
    setFlagCount(0);
    segmentsRef.current = [];
    anchorsRef.current = [];
    startedAtRef.current = Date.now();
    const recorder = createAmbientRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start(segment => {
        segmentsRef.current = [...segmentsRef.current, segment];
        setLiveCount(segmentsRef.current.length);
      });
      setPhase('recording');
    } catch (e) {
      recorderRef.current = null;
      setError(e instanceof Error ? e.message : 'Could not start recording.');
    }
  }, []);

  const stop = useCallback(async () => {
    let result: { path: string; durationSeconds: number } | null = null;
    try {
      result = (await recorderRef.current?.stop()) ?? null;
    } finally {
      recorderRef.current = null;
    }
    const captured = segmentsRef.current;
    const startedAt = startedAtRef.current;
    if (!result || captured.length === 0) {
      setPhase('idle');
      return;
    }
    if (!mobileSpeechInputPorts.transcriber.ready()) {
      setError('Set up a transcription model in Models, then record.');
      setPhase('idle');
      return;
    }
    setPhase('processing');
    setProgress({ phase: 'transcribing', done: 0, total: 1 });
    try {
      await ensureAmbientSliceDir();
      const built = await buildTimelineSessions(
        captured,
        result.path,
        startedAt,
        {
          ...createDefaultTimelineBuildDeps(useAmbientTimelineStore.getState().onDeviceOnly),
          onProgress: setProgress
        },
        anchorsRef.current
      );
      useAmbientTimelineStore.getState().addSessions(built);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not process the recording.');
    } finally {
      setPhase('idle');
      setProgress(null);
    }
  }, []);

  const recording = phase === 'recording';
  const processing = phase === 'processing';
  const days = groupSessionsByDay(sessions, dateParts);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Timeline" onBack={() => navigation.goBack()} />
      <CaptureBar
        styles={styles}
        colors={colors}
        recording={recording}
        processing={processing}
        liveCount={liveCount}
        elapsedMs={elapsedMs}
        progress={progress}
        onToggle={recording ? stop : start}
      />
      {recording ? (
        <TouchableOpacity
          style={styles.flagButton}
          onPress={flag}
          testID="ambient-flag"
          activeOpacity={0.8}
        >
          <Icon name="flag" size={18} color={colors.primary} />
          <Text style={styles.flagButtonText}>
            {flagCount === 0 ? 'Flag this moment' : `Flagged ${flagCount}`}
          </Text>
          <Text style={styles.flagHint}>marks what matters for the summary</Text>
        </TouchableOpacity>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {sessions.length > 0 && !recording ? (
        <AskBar
          styles={styles}
          colors={colors}
          value={askQuery}
          onChange={setAskQuery}
          onSubmit={ask}
          asking={asking}
          result={askResult}
          onClear={() => {
            setAskResult(null);
            setAskQuery('');
          }}
          onSource={id => navigation.navigate('AmbientSession', { sessionId: id })}
        />
      ) : null}
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {processing ? <ProcessingSkeleton styles={styles} /> : null}
        {days.length === 0 && !processing ? (
          <View style={styles.empty} testID="ambient-timeline-empty">
            <Text style={styles.emptyTitle}>Nothing captured yet</Text>
            <Text style={styles.emptyBody}>
              Start recording, talk, and stop. Each conversation is transcribed and summarised on this
              device and lands here as a card.
            </Text>
          </View>
        ) : (
          days.map(day => (
            <View key={day.dayKey} testID="ambient-day">
              <View style={styles.dayHeader}>
                <Text style={styles.dayLabel}>{dayLabel(day.dayKey)}</Text>
                <Text style={styles.dayStat}>
                  {day.sessions.length} conversation{day.sessions.length === 1 ? '' : 's'} ·{' '}
                  {formatDuration(day.speechMs)} speech
                </Text>
              </View>
              {day.sessions.map(session => (
                <SessionCard
                  key={session.id}
                  session={session}
                  styles={styles}
                  colors={colors}
                  onPress={() => navigation.navigate('AmbientSession', { sessionId: session.id })}
                />
              ))}
            </View>
          ))
        )}
        <View style={styles.privacyRow} testID="ambient-privacy">
          <View style={styles.privacyText}>
            <Text style={styles.privacyTitle}>Keep summaries on-device</Text>
            <Text style={styles.privacyBody}>
              Summaries and ask-your-day stay on this device even when a remote chat model is selected.
              Capture and transcription are always on-device.
            </Text>
          </View>
          <Switch
            value={onDeviceOnly}
            onValueChange={setOnDeviceOnly}
            trackColor={{ true: colors.primary, false: colors.border }}
            testID="ambient-privacy-switch"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function progressLabel(progress: BuildProgress | null): string {
  if (!progress) return 'Processing…';
  if (progress.phase === 'loading-model') return 'Loading summary model…';
  if (progress.phase === 'transcribing') {
    return `Transcribing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`;
  }
  return `Summarising ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`;
}

function CaptureBar({
  styles,
  colors,
  recording,
  processing,
  liveCount,
  elapsedMs,
  progress,
  onToggle
}: {
  styles: any;
  colors: any;
  recording: boolean;
  processing: boolean;
  liveCount: number;
  elapsedMs: number;
  progress: BuildProgress | null;
  onToggle: () => void;
}): React.ReactElement {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!recording) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 700, useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [recording, pulse]);

  const status = processing
    ? progressLabel(progress)
    : recording
      ? `REC ${formatClockDuration(elapsedMs)} · ${liveCount} segment${liveCount === 1 ? '' : 's'}`
      : 'Ready to record';

  return (
    <View style={[styles.captureBar, recording && styles.captureBarActive]}>
      <View style={styles.captureStatus}>
        <Animated.View
          style={[
            styles.recDot,
            {
              backgroundColor: recording ? colors.error : processing ? colors.primary : colors.border,
              opacity: recording ? pulse : 1
            }
          ]}
          testID="ambient-rec-dot"
        />
        <Text style={styles.captureStatusText} testID="ambient-status">
          {status}
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.captureBtn, recording ? styles.captureBtnStop : styles.captureBtnStart]}
        onPress={onToggle}
        disabled={processing}
        testID="ambient-capture-toggle"
        activeOpacity={0.85}
      >
        <Text style={[styles.captureBtnText, recording && styles.captureBtnTextStop]}>
          {processing ? 'Working…' : recording ? 'Stop' : 'Record'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

function askStatusHint(result: AskResult): string {
  switch (result.status) {
    case 'no-model':
      return 'Load a chat model (or select a remote one) to ask your day.';
    case 'no-matches':
      return 'Nothing in your day matches that. Try different words.';
    case 'error':
      return 'Could not answer that. Try again.';
    default:
      return result.answer;
  }
}

/** Ask-your-day: a question over the day's conversations, answered on-device (or your remote model). */
function AskBar({
  styles,
  colors,
  value,
  onChange,
  onSubmit,
  asking,
  result,
  onClear,
  onSource
}: {
  styles: any;
  colors: any;
  value: string;
  onChange: (t: string) => void;
  onSubmit: () => void;
  asking: boolean;
  result: AskResult | null;
  onClear: () => void;
  onSource: (id: string) => void;
}): React.ReactElement {
  return (
    <View style={styles.askWrap}>
      <View style={styles.askBar}>
        <Icon name="search" size={15} color={colors.textMuted} />
        <TextInput
          style={styles.askInput}
          placeholder="Ask your day…"
          placeholderTextColor={colors.textMuted}
          value={value}
          onChangeText={onChange}
          onSubmitEditing={onSubmit}
          returnKeyType="search"
          testID="ambient-ask-input"
        />
        {asking ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : result ? (
          <TouchableOpacity onPress={onClear} testID="ambient-ask-clear">
            <Icon name="x" size={16} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>
      {result && !asking ? (
        <View style={styles.askAnswer} testID="ambient-ask-answer">
          <Text style={styles.askAnswerText}>{askStatusHint(result)}</Text>
          {result.sources.length > 0 ? (
            <View style={styles.chipRow}>
              {result.sources.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={styles.chip}
                  onPress={() => onSource(s.id)}
                  testID="ambient-ask-source"
                >
                  <Text style={styles.chipText}>
                    {formatClock(s.startMs)} · {s.summary.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Placeholder cards shown while a capture is being transcribed and summarised. */
function ProcessingSkeleton({ styles }: { styles: any }): React.ReactElement {
  return (
    <View testID="ambient-skeleton">
      <View style={styles.dayHeader}>
        <Text style={styles.dayLabel}>PROCESSING</Text>
      </View>
      {[0, 1].map(i => (
        <View key={i} style={[styles.card, styles.skeletonCard]}>
          <View style={[styles.skeletonLine, { width: '40%' }]} />
          <View style={[styles.skeletonLine, { width: '90%' }]} />
          <View style={[styles.skeletonLine, { width: '65%' }]} />
        </View>
      ))}
    </View>
  );
}

function SessionCard({
  session,
  styles,
  colors,
  onPress
}: {
  session: TimelineSession;
  styles: any;
  colors: any;
  onPress: () => void;
}): React.ReactElement {
  const { summary } = session;
  const chips: string[] = [];
  if (summary.decisions.length > 0) {
    chips.push(`${summary.decisions.length} decision${summary.decisions.length === 1 ? '' : 's'}`);
  }
  if (summary.actionItems.length > 0) {
    chips.push(`${summary.actionItems.length} action${summary.actionItems.length === 1 ? '' : 's'}`);
  }
  if (summary.people.length > 0) {
    chips.push(`${summary.people.length} ${summary.people.length === 1 ? 'person' : 'people'}`);
  }
  const flagged = session.flaggedSegmentIds.length;
  const headline = summary.headline || summaryStatusHint(session.summaryStatus);

  // Slide + fade in on mount, so a freshly summarised card arrives rather than pops.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [enter]);
  const animatedStyle = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }]
  };

  return (
    <Animated.View style={animatedStyle}>
    <TouchableOpacity style={styles.card} onPress={onPress} testID="ambient-session-card" activeOpacity={0.8}>
      <View style={styles.cardTopRow}>
        <Text style={styles.cardTime}>{formatClock(session.startMs)}</Text>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {summary.title}
        </Text>
        <Text style={styles.cardDuration}>{formatDuration(session.speechMs)}</Text>
        <Icon name="chevron-right" size={16} color={colors.textMuted} />
      </View>
      <Text style={styles.cardHeadline} numberOfLines={2} testID="ambient-card-headline">
        {headline}
      </Text>
      {chips.length > 0 || flagged > 0 ? (
        <View style={styles.chipRow}>
          {flagged > 0 ? (
            <View style={[styles.chip, styles.chipFlag]} testID="ambient-card-flag">
              <Icon name="flag" size={11} color={colors.primary} />
              <Text style={styles.chipFlagText}>{flagged} flagged</Text>
            </View>
          ) : null}
          {chips.map(chip => (
            <View key={chip} style={styles.chip}>
              <Text style={styles.chipText}>{chip}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </TouchableOpacity>
    </Animated.View>
  );
}

function dateParts(epochMs: number): { y: number; m: number; d: number } {
  const date = new Date(epochMs);
  return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
}

function todayKey(): string {
  const { y, m, d } = dateParts(Date.now());
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}

function dayLabel(dayKey: string): string {
  if (dayKey === todayKey()) return 'TODAY';
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date
    .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    .toUpperCase();
}

function formatClock(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Elapsed span as M:SS (recording timer), distinct from the wall-clock formatClock. */
function formatClockDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

function createStyles(colors: {
  background: string;
  text: string;
  textMuted: string;
  textSecondary: string;
  surface: string;
  border: string;
  error: string;
  primary: string;
}) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    error: { color: colors.error, fontSize: 13, paddingHorizontal: 16, paddingBottom: 8 },
    // Capture bar
    captureBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border
    },
    captureBarActive: { borderBottomColor: colors.error },
    captureStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
    recDot: { width: 10, height: 10, borderRadius: 5 },
    captureStatusText: { color: colors.textSecondary, fontSize: 13 },
    captureBtn: {
      paddingHorizontal: 18,
      paddingVertical: 9,
      borderRadius: 6,
      borderWidth: 1
    },
    captureBtnStart: { backgroundColor: colors.primary, borderColor: colors.primary },
    captureBtnStop: { backgroundColor: 'transparent', borderColor: colors.error },
    captureBtnText: { color: colors.background, fontSize: 13, fontWeight: '700' },
    captureBtnTextStop: { color: colors.error },
    // Flag (note-first anchoring)
    flagButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface
    },
    flagButtonText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
    flagHint: { color: colors.textMuted, fontSize: 11, flex: 1, textAlign: 'right' },
    // List
    list: { flex: 1 },
    listContent: { paddingBottom: 32 },
    empty: { padding: 24, gap: 8 },
    emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
    emptyBody: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
    // Ask-your-day
    askWrap: { borderBottomWidth: 1, borderBottomColor: colors.border },
    askBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10
    },
    askInput: { flex: 1, color: colors.text, fontSize: 14, padding: 0 },
    askAnswer: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
    askAnswerText: { color: colors.text, fontSize: 13, lineHeight: 19 },
    // Skeleton
    skeletonCard: { gap: 8, opacity: 0.6 },
    skeletonLine: { height: 10, borderRadius: 3, backgroundColor: colors.border },
    // Day header
    dayHeader: {
      paddingHorizontal: 16,
      paddingTop: 20,
      paddingBottom: 8,
      backgroundColor: colors.background
    },
    dayLabel: { color: colors.text, fontSize: 13, fontWeight: '700', letterSpacing: 1 },
    dayStat: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
    // Session card
    card: {
      marginHorizontal: 12,
      marginVertical: 4,
      padding: 12,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      gap: 6
    },
    cardTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    cardTime: { color: colors.primary, fontSize: 12, fontWeight: '700' },
    cardTitle: { color: colors.text, fontSize: 14, fontWeight: '600', flex: 1 },
    cardDuration: { color: colors.textMuted, fontSize: 12 },
    cardHeadline: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
    chip: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background
    },
    chipText: { color: colors.textSecondary, fontSize: 11 },
    chipFlag: { flexDirection: 'row', alignItems: 'center', gap: 4, borderColor: colors.primary },
    chipFlagText: { color: colors.primary, fontSize: 11, fontWeight: '600' },
    // Privacy toggle
    privacyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginTop: 24,
      marginHorizontal: 12,
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: colors.border
    },
    privacyText: { flex: 1, gap: 3 },
    privacyTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
    privacyBody: { color: colors.textMuted, fontSize: 11, lineHeight: 16 }
  });
}

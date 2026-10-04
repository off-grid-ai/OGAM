/**
 * The Day view — the ambient recorder's home.
 *
 * The main surface is the BRIEF - Journal, To do, Actions - the stuff you read each morning. The
 * Timeline of conversations lives behind a chip (its own slide-over), Ask is docked at the bottom
 * next to the record button so it's always at your thumb, and the recorder settings sit behind a gear.
 * Value on the home screen; reference, config and the source conversation are each one tap away.
 *
 * Terminal/brutalist, Menlo, emerald. Reads the store; capture runs through the shared useAmbientCapture.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { ScreenHeader } from '../components/ScreenHeader';
import { requestSyncResync } from '../services/syncResync';
import { LoadingDots } from '../components/LoadingDots';
import { VoiceSpectrum } from '../components/VoiceSpectrum';
import { useAmbientCapture, processPending as drainPending, currentCapturePhase, reprocessDay, devReplayLastTranscript } from '../hooks/useAmbientCapture';
import { useAmbientTimelineStore } from '../stores/ambientTimelineStore';
import { useSpeakerProfilesStore } from '../stores/speakerProfilesStore';
import {
  collectDayTasks,
  collectStandaloneTasks,
  openTaskCount,
  sessionsForDay,
  dayKeysWithSessions,
  type DayTask
} from '../services/ambient/dayModel';
import { journalForDay } from '../services/ambient/journalFactory';
import { proposeActionsForDay } from '../services/ambient/actionsFactory';
import { runAudioRetention } from '../services/ambient/retentionService';
import { ProcessingSchedulePicker } from '../components/ambient/ProcessingSchedulePicker';
import { shouldRunScheduled } from '../services/ambient/scheduleModel';
import { useOpenSync } from '../hooks/useOpenSync';
import { useVoiceRecognitionUnlocked } from '../hooks/useVoiceRecognitionUnlocked';
import { mobileSpeechInputPorts } from '../services/adapters/speech/mobileSpeechInputPorts';
import { macOffloadReady } from '../services/ambient/macSttExecutorFactory';
import { mobileTextEngineControl } from '../services/modelServices/textEngineControl';
import { loadTranscriptionModel } from '../services/transcriptionModelApplication';
import { activeMobileRoute } from '../services/modelServices/mobileLLMService';
import { selectedTextModelId } from '../services/modelServices/modelState';
import { mobileResidencyIntents } from '../services/modelServices/residencyIntents';
import { formatTodosForActions, formatCallsForActions } from '../services/ambient/actionsModel';
import { askDayWithDeviceLLM } from '../services/ambient/askDayFactory';
import type { AskResult } from '../services/ambient/askDay';
import type { TimelineSession } from '../services/ambient/timelineModel';
import { sessionSpeakers, isIncludedSession } from '../services/ambient/timelineModel';
import type { ProactiveActionProposal } from '@offgrid/models';
import { TYPOGRAPHY, SPACING } from '../constants';

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
  return new Date(y, m - 1, d)
    .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    .toUpperCase();
}
function clock(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
// A day-task id is `${sessionId}#${index}`; the action-item index is after the last '#'.
function taskIndexOf(id: string): number {
  return Number(id.slice(id.lastIndexOf('#') + 1));
}
// Big recording clock: H:MM:SS once past an hour, MM:SS before.
function hms(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number): string => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function AmbientDayScreen(): React.ReactElement {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation<any>();
  const capture = useAmbientCapture();
  // Manual "catch up now": ask every connected peer to re-sync, so the Day converges on demand without
  // waiting for the next change/reconnect. Brief spinner; the catch-up itself is async over the channel.
  const [syncing, setSyncing] = useState(false);
  const onSyncNow = useCallback(() => {
    setSyncing(true);
    requestSyncResync();
    setTimeout(() => setSyncing(false), 1500);
  }, []);

  const sessions = useAmbientTimelineStore(s => s.sessions);
  const doneTaskIds = useAmbientTimelineStore(s => s.doneTaskIds);
  const journalByDay = useAmbientTimelineStore(s => s.journalByDay);
  const actionsByDay = useAmbientTimelineStore(s => s.actionsByDay);
  const toggleTask = useAmbientTimelineStore(s => s.toggleTask);
  const standaloneTodos = useAmbientTimelineStore(s => s.standaloneTodos);
  const toggleStandaloneTodo = useAmbientTimelineStore(s => s.toggleStandaloneTodo);
  const editTaskText = useAmbientTimelineStore(s => s.editTaskText);
  const deleteTask = useAmbientTimelineStore(s => s.deleteTask);
  const setSessionInclusion = useAmbientTimelineStore(s => s.setSessionInclusion);
  const resolveDayAction = useAmbientTimelineStore(s => s.resolveDayAction);
  const pendingCaptures = useAmbientTimelineStore(s => s.pendingCaptures);
  const processingMode = useAmbientTimelineStore(s => s.processingMode);
  const setProcessingMode = useAmbientTimelineStore(s => s.setProcessingMode);
  const processingMinuteOfDay = useAmbientTimelineStore(s => s.processingMinuteOfDay);
  const setProcessingMinuteOfDay = useAmbientTimelineStore(s => s.setProcessingMinuteOfDay);
  const onDeviceOnly = useAmbientTimelineStore(s => s.onDeviceOnly);
  const setOnDeviceOnly = useAmbientTimelineStore(s => s.setOnDeviceOnly);
  const useMacForTranscription = useAmbientTimelineStore(s => s.useMacForTranscription);
  const setUseMacForTranscription = useAmbientTimelineStore(s => s.setUseMacForTranscription);
  const audioRetentionDays = useAmbientTimelineStore(s => s.audioRetentionDays);
  const clearAll = useAmbientTimelineStore(s => s.clearAll);
  const clearPendingCaptures = useAmbientTimelineStore(s => s.clearPendingCaptures);
  const setAudioRetentionDays = useAmbientTimelineStore(s => s.setAudioRetentionDays);
  const captureMode = useAmbientTimelineStore(s => s.captureMode);
  const clearVoices = useSpeakerProfilesStore(s => s.clear);
  const voiceCount = useSpeakerProfilesStore(s => Object.keys(s.profiles).length);
  const setCaptureMode = useAmbientTimelineStore(s => s.setCaptureMode);
  const { openSync } = useOpenSync();
  const isPro = useVoiceRecognitionUnlocked();
  const [ready, setReady] = useState(() => ({
    stt: mobileSpeechInputPorts.transcriber.ready(),
    mac: macOffloadReady()
  }));
  const [loadingModel, setLoadingModel] = useState(false);
  // The recording + processing states take over the whole screen (focused capture, then a staged
  // pipeline). "Keep in background" on the processing screen minimizes it back to the Day; cleared
  // automatically once processing ends so the next run opens the full screen again.
  const [processingMinimized, setProcessingMinimized] = useState(false);
  useEffect(() => {
    if (!capture.processing) setProcessingMinimized(false);
  }, [capture.processing]);
  const refreshReady = useCallback(() => {
    setReady({ stt: mobileSpeechInputPorts.transcriber.ready(), mac: macOffloadReady() });
  }, []);
  const openModels = useCallback(
    () =>
      navigation.navigate('Main', {
        screen: 'ModelsTab',
        params: { initialTab: 'transcription' }
      }),
    [navigation]
  );
  // The Day recorder considers transcription "set up" if a local model is loaded OR simply selected
  // (local models load lazily on first record — a downloaded+selected model must not read as missing),
  // or the Mac can do it. Mirrors the record-time gate so the empty-state nudge never lies.
  const localTranscriptionModel = activeMobileRoute('transcription').model;
  const hasLocalTranscription =
    ready.stt || (!!localTranscriptionModel && localTranscriptionModel.source !== 'remote');
  const macActiveForTranscription = useMacForTranscription && !onDeviceOnly && ready.mac;
  const transcriptionSetUp = hasLocalTranscription || macActiveForTranscription;
  // What will actually do the work right now. The record path prefers the Mac when it's enabled and
  // reachable, otherwise the phone's local model. Surfaced on the home screen so it's never a surprise.
  const transcriptionSource: 'mac' | 'local' | 'none' = macActiveForTranscription
    ? 'mac'
    : hasLocalTranscription
      ? 'local'
      : 'none';
  // The toggle is on but the Mac isn't actually connected as a Remote Server, so it silently falls back
  // to the phone. Surface that directly — it's the single most common "why isn't my Mac used?" cause.
  const macWantedButOffline = useMacForTranscription && !onDeviceOnly && !ready.mac;

  // Wipe the Day back to a first-run state (recordings, journal, to-dos, timeline, queue).
  const resetDay = useCallback(() => {
    const wipeData = () => {
      clearAll();
      clearPendingCaptures();
      setShowSettings(false);
    };
    const buttons: Parameters<typeof Alert.alert>[2] = [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Day data only', style: 'destructive', onPress: wipeData },
    ];
    if (voiceCount > 0) {
      buttons.push({
        text: `Data + ${voiceCount} voice${voiceCount === 1 ? '' : 's'}`,
        style: 'destructive',
        onPress: () => {
          clearVoices();
          wipeData();
        },
      });
    }
    Alert.alert(
      'Clear Day data?',
      voiceCount > 0
        ? 'Removes recordings, journal, to-dos and the timeline. You can also delete your enrolled voices. This cannot be undone.'
        : 'Removes every recording, journal, to-do and timeline entry from this device. This cannot be undone.',
      buttons
    );
  }, [clearAll, clearPendingCaptures, clearVoices, voiceCount]);

  // Sanity check before recording: transcription and the summary/journal use DIFFERENT engines, so warn
  // up front if either is missing instead of letting the user find out from an empty Day later.
  const handleRecordPress = useCallback(async () => {
    let localReady = mobileSpeechInputPorts.transcriber.ready();
    // A selected-but-unloaded local whisper model: load it on demand so "set in Models" is enough to
    // record — selection is deliberately lazy (no eager native load), and Mac offload never loads it.
    if (!localReady) {
      const model = activeMobileRoute('transcription').model;
      if (model && model.source !== 'remote') {
        setLoadingModel(true);
        try {
          await loadTranscriptionModel();
        } catch {
          // Fall through to the warning below if the load fails.
        }
        // The native load can settle a beat after load() resolves — poll readiness briefly.
        for (let i = 0; i < 20 && !mobileSpeechInputPorts.transcriber.ready(); i += 1) {
          await new Promise(r => setTimeout(r, 400));
        }
        setLoadingModel(false);
        localReady = mobileSpeechInputPorts.transcriber.ready();
        refreshReady();
      }
    }
    const transcriptionReady =
      localReady || (useMacForTranscription && !onDeviceOnly && macOffloadReady());
    // A summary/journal/to-dos happen iff there's a text model to make them: one loaded, one selected
    // on-device (the build loads it on demand), or a reachable remote when offload is allowed. Checking
    // only isReady() (loaded) is wrong on both ends — it warns when a downloaded model would load fine,
    // and stays silent when there's genuinely no model to summarise with.
    const summaryReady =
      mobileTextEngineControl.isReady() ||
      selectedTextModelId() != null ||
      (!onDeviceOnly && mobileTextEngineControl.isRemoteActive());
    if (transcriptionReady && summaryReady) {
      // Everything is "set up" — but a local model can still fail to LOAD at processing time if the
      // phone is low on memory, which would waste the whole session. When the Mac won't actually take
      // it, check up front (this does NOT trigger a load) and warn so it can be avoided or accepted.
      // NOTE: the "Transcribe on Mac" toggle is only a preference — offload runs only when the Mac is
      // connected as a Remote Server (macOffloadReady), NOT from Sync alone. A toggle that's on but a
      // Mac that isn't connected silently falls back to the phone, so we call that out specifically.
      const wantsMac = useMacForTranscription && !onDeviceOnly;
      // Each model runs where it's routed: transcription on the Mac only when offload is live; the
      // summary on the Mac only when a remote text model is active (auto-selected when you pair a Mac).
      // Only warn about a model that will actually load on THIS phone.
      const transcriptionOnMac = wantsMac && macOffloadReady();
      const summaryOnMac = !onDeviceOnly && mobileTextEngineControl.isRemoteActive();
      {
        const tight: string[] = [];
        if (!summaryOnMac) {
          const textId = selectedTextModelId();
          if (textId && !(await mobileResidencyIntents.canPreloadText(textId))) tight.push('summary');
        }
        if (!transcriptionOnMac) {
          const sttModel = activeMobileRoute('transcription').model;
          if (
            sttModel &&
            sttModel.source !== 'remote' &&
            !mobileResidencyIntents.canPreloadTranscription(sttModel.id)
          ) {
            tight.push('transcription');
          }
        }
        if (tight.length > 0) {
          const models = `${tight.join(' and ')} model${tight.length > 1 ? 's' : ''}`;
          const macButOffline = wantsMac; // wanted the Mac, but something still falls back to the phone
          const buttons: {
            text: string;
            style?: 'cancel';
            onPress?: () => void;
          }[] = [];
          if (!onDeviceOnly) {
            // Where you actually connect the Mac for offload — not Sync.
            buttons.push({ text: 'Connect Mac', onPress: () => navigation.navigate('RemoteServers') });
          }
          buttons.push({ text: 'Record anyway', onPress: () => void capture.start() });
          buttons.push({ text: 'Cancel', style: 'cancel' });
          Alert.alert(
            macButOffline ? "Your Mac isn't connected" : 'Low on memory',
            macButOffline
              ? `Your Mac is set to handle recordings, but it isn't connected as a Remote Server right now — so this will run on this phone, which may not have enough memory to load the ${models}. Connect your Mac (Sync alone won't do it), free up memory, or record anyway. Audio is always saved and you can retry from the Day screen.`
              : `This phone may not have enough free memory to load the ${models} when it processes this recording. Your audio is always saved, but processing can fail until you free up memory (close other apps) or connect your Mac — you can retry any time from the Day screen.`,
            buttons
          );
          return;
        }
      }
      void capture.start();
      return;
    }
    const lines: string[] = [];
    if (!transcriptionReady) {
      lines.push('• No transcriber is ready — the recording will be saved and transcribed once your Mac is reachable or a model is set up.');
    }
    if (!summaryReady) {
      lines.push('• No chat model is set up — you\'ll get the transcript, but no summary, to-dos, or journal until you add one in Models.');
    }
    Alert.alert(
      'Before you record',
      lines.join('\n\n'),
      [
        {
          text: 'Set up',
          onPress: () =>
            navigation.navigate('Main', {
              screen: 'ModelsTab',
              params: { initialTab: !summaryReady ? 'text' : 'transcription' }
            })
        },
        { text: 'Record anyway', onPress: () => void capture.start() },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  }, [capture, navigation, useMacForTranscription, onDeviceOnly, refreshReady]);
  // Always-on orchestration is hoisted to AlwaysOnDaemon (app root) so Live mode records
  // app-wide from launch, not only while this screen is mounted.

  const dayKeys = useMemo(() => dayKeysWithSessions(sessions, dateParts), [sessions]);
  const [dayIndex, setDayIndex] = useState(0);
  const dayKey = dayKeys[dayIndex] ?? todayKey();
  const daySessions = useMemo(
    () => sessionsForDay(sessions, dayKey, dateParts),
    [sessions, dayKey]
  );
  const doneSet = useMemo(() => new Set(doneTaskIds), [doneTaskIds]);
  // Relevance split: the owner's conversations drive the Day's intelligence (journal, to-dos, actions);
  // "ambient" ones (overheard talk, traffic, a TV) are kept + searchable but tucked into a collapsed
  // section so they don't clutter the Day or seed to-dos. An unassessed session (no verdict) counts as
  // relevant, so nothing regresses before the relevance gate has run.
  // The Day is a projection over INCLUDED conversations (relevance verdict, overridable by the user's
  // select/deselect). To-dos are a pure projection over them, so removing a conversation drops its
  // to-dos automatically; the journal + actions regenerate over the included set (cache cleared on toggle).
  const includedDaySessions = useMemo(() => daySessions.filter(isIncludedSession), [daySessions]);
  const excludedDaySessions = useMemo(() => daySessions.filter(s => !isIncludedSession(s)), [daySessions]);
  const sessionTasks = useMemo(
    () => collectDayTasks(includedDaySessions, doneSet),
    [includedDaySessions, doneSet]
  );
  // Peer-authored standalone to-dos (e.g. desktop CRM to-dos) are undated, so they live under Today —
  // shown first, above the day's recorder tasks. On any other day the list is just that day's sessions'.
  const standaloneTasks = useMemo(
    () => (dayKey === todayKey() ? collectStandaloneTasks(standaloneTodos) : []),
    [standaloneTodos, dayKey]
  );
  const tasks = useMemo(
    () => [...standaloneTasks, ...sessionTasks],
    [standaloneTasks, sessionTasks]
  );
  const journal = journalByDay[dayKey];

  // Signature of the day's INCLUDED set — the journal + actions are stitched over exactly these, so a
  // change (select/deselect) must re-generate. Keying the once-only request guard by this signature (not
  // just dayKey) lets a re-projection re-run after the cache is cleared, while still de-duping within a set.
  const includedSignature = useMemo(
    () => `${dayKey}|${includedDaySessions.map(s => s.id).join(',')}`,
    [dayKey, includedDaySessions],
  );

  // Generate the day's journal once per included-set, when the day has conversations but no cached narrative.
  const journalRequested = useRef<Set<string>>(new Set());
  const [journalBusy, setJournalBusy] = useState(false);
  useEffect(() => {
    if (includedDaySessions.length === 0 || journalByDay[dayKey] !== undefined) return;
    if (journalRequested.current.has(includedSignature)) return;
    journalRequested.current.add(includedSignature);
    setJournalBusy(true);
    journalForDay(
      includedDaySessions.map(s => ({
        title: s.summary.title,
        headline: s.summary.headline,
        people: s.summary.people
      })),
      useAmbientTimelineStore.getState().onDeviceOnly
    )
      .then(res => {
        if (res.status === 'ok' && res.text) {
          useAmbientTimelineStore.getState().setDayJournal(dayKey, res.text);
        }
      })
      .finally(() => setJournalBusy(false));
  }, [dayKey, includedDaySessions, journalByDay, includedSignature]);

  // Propose the day's actions once per included-set, when it has conversations but no cached proposals.
  const actionsRequested = useRef<Set<string>>(new Set());
  const [actionsBusy, setActionsBusy] = useState(false);
  const actions = actionsByDay[dayKey];
  // Actions are hidden for now — the proposal generation runs, but mobile has no verified connector
  // execution behind Approve, so we don't surface it (or waste the text model on it) until it's tested.
  // To re-enable: restore this effect body and the "Actions" Section in the render below.
  // useEffect(() => {
  //   if (includedDaySessions.length === 0 || actionsByDay[dayKey] !== undefined) return;
  //   if (actionsRequested.current.has(includedSignature)) return;
  //   actionsRequested.current.add(includedSignature);
  //   setActionsBusy(true);
  //   proposeActionsForDay(
  //     {
  //       todos: formatTodosForActions(tasks),
  //       calls: formatCallsForActions(includedDaySessions)
  //     },
  //     useAmbientTimelineStore.getState().onDeviceOnly
  //   )
  //     .then(res => useAmbientTimelineStore.getState().setDayActions(dayKey, res.proposals))
  //     .finally(() => setActionsBusy(false));
  // }, [dayKey, includedDaySessions, actionsByDay, tasks, includedSignature]);

  // Ask-your-day, scoped to the current day.
  const [askQuery, setAskQuery] = useState('');
  const [asking, setAsking] = useState(false);
  // Ask-your-day runs as a short Q&A thread inside a slide-up sheet (not a floating card), so the answer
  // has room to read, cites its source conversations, and supports follow-ups.
  const [askThread, setAskThread] = useState<{ q: string; result: AskResult | null }[]>([]);
  const [showAsk, setShowAsk] = useState(false);

  // Reference + config live off the main surface, one tap away.
  const [showTimeline, setShowTimeline] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Ambient (overheard) conversations stay collapsed in the timeline until the owner asks to see them.
  const [ambientExpanded, setAmbientExpanded] = useState(false);
  const runAsk = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || asking) return;
      setAskQuery('');
      setShowAsk(true);
      setAskThread(t => [...t, { q: question, result: null }]);
      setAsking(true);
      try {
        const onDeviceOnly = useAmbientTimelineStore.getState().onDeviceOnly;
        // The text model may have been evicted by the recorder's residency juggling even though it's
        // selected/downloaded — load it on demand so Ask doesn't falsely report "no chat model".
        const textId = selectedTextModelId();
        const remoteText = !onDeviceOnly && mobileTextEngineControl.isRemoteActive();
        if (textId && !remoteText && !mobileTextEngineControl.isReady()) {
          await mobileResidencyIntents.ensureText(textId).catch(() => undefined);
        }
        const result = await askDayWithDeviceLLM(
          question,
          daySessions,
          clock,
          onDeviceOnly
        );
        setAskThread(t => t.map((e, i) => (i === t.length - 1 ? { ...e, result } : e)));
      } finally {
        setAsking(false);
      }
    },
    [asking, daySessions]
  );

  // One timeline row, shared by the day list and the collapsed Set-aside group. `excluded` dims it and
  // flips the toggle: an included row shows "remove from day", a set-aside row shows "add to day". The
  // toggle sets the user override and clears the day's journal/actions cache so everything re-projects.
  const renderTimelineRow = useCallback(
    (session: TimelineSession, excluded = false, first = false) => (
      <TouchableOpacity
        key={session.id}
        style={[styles.tcard, !first && styles.taskDivider, excluded && styles.tcardAmbient]}
        onPress={() => {
          setShowTimeline(false);
          navigation.navigate('AmbientSession', { sessionId: session.id });
        }}
        testID={excluded ? 'ambient-timeline-row-ambient' : 'ambient-timeline-row'}
      >
        <Text style={styles.tcardTime}>{clock(session.startMs)}</Text>
        <View style={styles.tcardMid}>
          <Text style={styles.tcardTitle} numberOfLines={1}>
            {session.summary.title}
          </Text>
          <Text style={styles.tcardHead} numberOfLines={1}>
            {session.summary.headline || 'No summary'}
          </Text>
          {sessionSpeakers(session).length > 0 ? (
            <View style={styles.tcardPeople}>
              <Icon name="users" size={11} color={colors.primary} />
              <Text style={styles.tcardPeopleText} numberOfLines={1}>
                {sessionSpeakers(session).join(' · ')}
              </Text>
            </View>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={() => setSessionInclusion(session.id, excluded ? true : false, dayKey)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          testID={excluded ? 'session-add-to-day' : 'session-remove-from-day'}
          accessibilityLabel={excluded ? 'Add to your day' : 'Remove from your day'}
        >
          <Icon name={excluded ? 'plus-circle' : 'minus-circle'} size={18} color={excluded ? colors.primary : colors.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    ),
    [navigation, styles, colors, setSessionInclusion, dayKey],
  );

  // Prune capture audio past the retention window, once per screen open.
  const retentionRan = useRef(false);
  useEffect(() => {
    if (retentionRan.current) return;
    retentionRan.current = true;
    runAudioRetention(useAmbientTimelineStore.getState().sessions, useAmbientTimelineStore.getState().audioRetentionDays).catch(() => undefined);
  }, []);

  // Deferred ("Later") queue: catch-up drain. If the background task never fired the scheduled run
  // (iOS gated it, or the app was closed), process the queue the next time we're open past today's
  // scheduled time. Runs at most once per scheduled day; marks the run only when the queue actually drained.
  const drainInFlight = useRef(false);
  useEffect(() => {
    const readyNow = (): boolean => {
      if (mobileSpeechInputPorts.transcriber.ready()) return true;
      const st = useAmbientTimelineStore.getState();
      return st.useMacForTranscription && !st.onDeviceOnly && macOffloadReady();
    };
    // Durable queue drain: process anything waiting the moment a transcriber is available. Failure-
    // queued (live) captures drain as soon as ready; "Later"/nightly captures wait for their time.
    const tryDrain = (): void => {
      if (drainInFlight.current) return;
      if (currentCapturePhase() !== 'idle') return; // never drain while recording/processing
      const st = useAmbientTimelineStore.getState();
      if (st.pendingCaptures.length === 0) return;
      if (!readyNow()) return; // wait for the Mac to come back, or a local model
      if (
        st.processingMode === 'nightly' &&
        !shouldRunScheduled(Date.now(), st.processingMinuteOfDay, st.lastScheduledProcessAt)
      )
        return;
      drainInFlight.current = true;
      drainPending()
        .then(() => {
          const after = useAmbientTimelineStore.getState();
          if (after.pendingCaptures.length === 0 && after.processingMode === 'nightly') {
            useAmbientTimelineStore.getState().markScheduledProcess(Date.now());
          }
        })
        .catch(() => undefined)
        .finally(() => {
          drainInFlight.current = false;
        });
    };
    tryDrain();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        tryDrain();
        refreshReady();
      }
    });
    // While captures are waiting, poll so an in-app network/Mac return auto-drains them.
    const poll = setInterval(() => {
      if (useAmbientTimelineStore.getState().pendingCaptures.length > 0) {
        tryDrain();
        refreshReady();
      }
    }, 15000);
    return () => {
      sub.remove();
      clearInterval(poll);
    };
  }, [refreshReady]);

  const open = openTaskCount(tasks);

  // Recording now stays on the Day screen (pulsing button + a fixed live caption in the dock), so the
  // full-screen recording takeover is retired. (RecordingView kept below but unused for now.)
  // After Pause, the pipeline runs: transcribe → find speakers → summarise → journal & to-dos, streamed
  // so it's never a frozen wall. "Keep in background" drops back to the Day while it finishes. (Concept: Processing.)
  if (capture.processing && !processingMinimized) {
    return (
      <ProcessingView
        styles={styles}
        colors={colors}
        capture={capture}
        onBackground={() => setProcessingMinimized(true)}
      />
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Day"
        onBack={() => navigation.goBack()}
        right={
          <View style={styles.headIcons}>
            <TouchableOpacity onPress={onSyncNow} disabled={syncing} testID="ambient-sync-now">
              {syncing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Icon name="refresh-cw" size={18} color={colors.textSecondary} />
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => navigation.navigate('AmbientReflect')} testID="ambient-open-reflect">
              <Icon name="bar-chart-2" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowSettings(true)} testID="ambient-open-settings">
              <Icon name="settings" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        }
      />

      <View style={styles.daynav}>
        <TouchableOpacity
          disabled={dayIndex >= dayKeys.length - 1}
          onPress={() => setDayIndex(i => Math.min(dayKeys.length - 1, i + 1))}
          style={styles.arrow}
          testID="ambient-day-prev"
        >
          <Icon name="chevron-left" size={20} color={dayIndex >= dayKeys.length - 1 ? colors.border : colors.textMuted} />
        </TouchableOpacity>
        <Text style={styles.dayLabel}>{dayLabel(dayKey)}</Text>
        <TouchableOpacity
          disabled={dayIndex <= 0}
          onPress={() => setDayIndex(i => Math.max(0, i - 1))}
          style={styles.arrow}
          testID="ambient-day-next"
        >
          <Icon name="chevron-right" size={20} color={dayIndex <= 0 ? colors.border : colors.textMuted} />
        </TouchableOpacity>
      </View>

      <CaptureStrip styles={styles} colors={colors} capture={capture} onReopen={() => setProcessingMinimized(false)} />
      {pendingCaptures.length > 0 && !capture.processing ? (
        // A failed run keeps the recordings queued (audio is never dropped), so this doubles as the
        // retry: on error it shows WHY and a Retry, otherwise the normal "process now" nudge.
        <TouchableOpacity
          style={[styles.pending, !!capture.error && styles.pendingError]}
          onPress={capture.processPending}
          testID="ambient-process-pending"
        >
          <Icon
            name={capture.error ? 'alert-triangle' : 'clock'}
            size={15}
            color={capture.error ? colors.error : colors.primary}
          />
          <Text style={styles.pendingText}>
            {capture.error
              ? capture.error
              : `${pendingCaptures.length} recording${pendingCaptures.length === 1 ? '' : 's'} waiting`}
          </Text>
          <Text style={[styles.pendingCta, !!capture.error && styles.pendingCtaError]}>
            {capture.error ? 'Retry' : 'Process now'}
          </Text>
        </TouchableOpacity>
      ) : capture.error ? (
        <Text style={styles.error}>{capture.error}</Text>
      ) : null}

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {daySessions.length === 0 ? (
          <View style={styles.empty} testID="ambient-day-empty">
            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <Icon name="mic" size={26} color={colors.primary} />
              </View>
              <Text style={styles.heroTitle}>Start your first recording</Text>
              <Text style={styles.heroBody}>
                Tap the mic below. Off Grid turns the conversation into your journal, to-dos, and a
                timeline — all on your terms.
              </Text>
            </View>

            {transcriptionSetUp ? (
              <View style={styles.readyChip}>
                <Icon name="check-circle" size={15} color={colors.primary} />
                <Text style={styles.readyChipText}>
                  Transcription ready
                  {/* Match the active source shown in the bottom bar: the Mac wins when offload is live. */}
                  {transcriptionSource === 'mac' ? ' · on your Mac' : ' · on-device'}
                </Text>
              </View>
            ) : (
              <View style={styles.nudge}>
                <Text style={styles.nudgeTitle}>One step to transcribe</Text>
                <Text style={styles.nudgeBody}>
                  Turn talk into text by downloading a model, or pair your Mac and let it do the work.
                </Text>
                <View style={styles.nudgeBtns}>
                  <TouchableOpacity
                    style={styles.nudgePrimary}
                    onPress={openModels}
                    testID="ambient-empty-download-model"
                  >
                    <Icon name="download" size={14} color={colors.background} />
                    <Text style={styles.nudgePrimaryText}>Download a model</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.nudgeGhost}
                    onPress={openSync}
                    testID="ambient-empty-sync"
                  >
                    <Icon name="airplay" size={14} color={colors.primary} />
                    <Text style={styles.nudgeGhostText}>Sync your Mac</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {!isPro ? (
              <TouchableOpacity
                style={styles.nudge}
                onPress={() => navigation.navigate('ProDetail')}
                activeOpacity={0.7}
                testID="ambient-voice-pro-upsell"
              >
                <Text style={styles.nudgeTitle}>Recognize who's speaking</Text>
                <Text style={styles.nudgeBody}>
                  Add your voice and let your Day tell people apart, so you can see who said what. Part
                  of Pro — your voiceprints stay on this device.
                </Text>
                <View style={styles.nudgeBtns}>
                  <View style={styles.nudgePrimary}>
                    <Icon name="lock" size={14} color={colors.background} />
                    <Text style={styles.nudgePrimaryText}>Unlock with Pro</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ) : voiceCount === 0 ? (
              <View style={styles.nudge}>
                <Text style={styles.nudgeTitle}>Add your voice</Text>
                <Text style={styles.nudgeBody}>
                  Record two short lines so your Day can tell when it's you speaking. Your voiceprint
                  stays on this device.
                </Text>
                <View style={styles.nudgeBtns}>
                  <TouchableOpacity
                    style={styles.nudgePrimary}
                    onPress={() => navigation.navigate('SpeakerEnrollment')}
                    testID="ambient-empty-add-voice"
                  >
                    <Icon name="mic" size={14} color={colors.background} />
                    <Text style={styles.nudgePrimaryText}>Record my voice</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <View style={styles.presetCard}>
              <Text style={styles.presetHead}>YOUR SETUP</Text>
              <View style={styles.presetRow}>
                <Text style={styles.presetKey}>Listening</Text>
                <Text style={styles.presetVal}>
                  {captureMode === 'always-on' ? 'Always-on' : 'One-tap'}
                </Text>
              </View>
              <View style={styles.presetRow}>
                <Text style={styles.presetKey}>Processing</Text>
                <Text style={styles.presetVal}>
                  {processingMode === 'nightly' ? 'Later' : 'Real-time'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.presetChange}
                onPress={() => setShowSettings(true)}
                testID="ambient-empty-settings"
              >
                <Icon name="sliders" size={13} color={colors.primary} />
                <Text style={styles.presetChangeText}>Change in Settings</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            <Section title="Journal" styles={styles} colors={colors} icon="book-open">
              <View style={[styles.card, styles.cardPad]}>
                {journal ? (
                  <Text style={styles.journal} testID="ambient-journal">
                    {journal}
                  </Text>
                ) : journalBusy ? (
                  <View style={styles.cardBusy}>
                    <LoadingDots size={6} />
                    <Text style={styles.muted}>Writing your journal…</Text>
                  </View>
                ) : (
                  <Text style={styles.muted}>No journal yet.</Text>
                )}
              </View>
            </Section>

            <Section
              title="To do"
              count={open > 0 ? `${open} to do` : 'all clear'}
              styles={styles}
              colors={colors}
              icon="check-circle"
            >
              <View style={styles.card}>
                {tasks.length === 0 ? (
                  <View style={styles.cardPad}>
                    <Text style={styles.muted}>No tasks came up.</Text>
                  </View>
                ) : (
                  tasks.map((task, i) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      first={i === 0}
                      styles={styles}
                      colors={colors}
                      onToggle={() =>
                        task.standaloneSource
                          ? toggleStandaloneTodo(task.id)
                          : toggleTask(task.id)
                      }
                      onOpen={() => navigation.navigate('AmbientSession', { sessionId: task.sessionId })}
                      onEdit={text => editTaskText(task.sessionId, taskIndexOf(task.id), text)}
                      onDelete={() =>
                        Alert.alert('Delete to-do?', task.text, [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => deleteTask(task.sessionId, taskIndexOf(task.id))
                          }
                        ])
                      }
                    />
                  ))
                )}
              </View>
            </Section>

            {/* Actions hidden for now — proposals generate but mobile has no verified connector execution
                behind Approve yet. Re-enable with the generation effect above when it's testable. */}
            {/* {actionsBusy || (actions && actions.length > 0) ? (
              <Section
                title="Actions"
                count={actions && actions.length > 0 ? `${actions.length} to approve` : undefined}
                styles={styles}
                colors={colors}
                icon="zap"
              >
                {actionsBusy && !actions ? (
                  <View style={[styles.card, styles.cardPad, styles.cardBusy]}>
                    <LoadingDots size={6} />
                    <Text style={styles.muted}>Looking for things it can do…</Text>
                  </View>
                ) : (
                  (actions ?? []).map((proposal, index) => (
                    <ActionCard
                      key={`${proposal.title ?? 'action'}-${index}`}
                      proposal={proposal}
                      styles={styles}
                      onApprove={() => resolveDayAction(dayKey, index)}
                      onDismiss={() => resolveDayAction(dayKey, index)}
                    />
                  ))
                )}
              </Section>
            ) : null} */}

            <TouchableOpacity
              style={styles.tlChip}
              onPress={() => setShowTimeline(true)}
              testID="ambient-open-timeline"
            >
              <Icon name="clock" size={15} color={colors.textMuted} />
              <Text style={styles.tlChipLabel}>Timeline</Text>
              <Text style={styles.tlChipN}>
                {includedDaySessions.length} conversation{includedDaySessions.length === 1 ? '' : 's'}
                {excludedDaySessions.length > 0 ? ` · ${excludedDaySessions.length} ambient` : ''}
              </Text>
              <Icon name="chevron-right" size={16} color={colors.primary} />
            </TouchableOpacity>
            <View style={{ height: 16 }} />
          </>
        )}
      </ScrollView>

      {/* Docked, top → bottom: the record control, then ask, then the transcription-source line pinned last. */}
      <View style={styles.dock}>
        {/* The one primary action, centered FIRST: record → pause, with the shared 3-dot loader while busy. */}
        <View style={styles.recordRow}>
          {capture.processing || loadingModel ? (
            <View style={[styles.recBtn, styles.recBtnBusy]} testID="ambient-day-busy">
              <LoadingDots color={colors.background} size={7} />
            </View>
          ) : capture.recording ? (
            <PulsingPauseButton styles={styles} colors={colors} onPress={capture.stop} />
          ) : (
            <TouchableOpacity style={styles.recBtn} onPress={() => void handleRecordPress()} testID="ambient-day-record" accessibilityLabel="Start recording">
              <Icon name="mic" size={24} color={colors.background} />
            </TouchableOpacity>
          )}
          {capture.recording ? (
            <Text style={styles.recHint}>Recording · tap to stop</Text>
          ) : !capture.processing && !loadingModel ? (
            <Text style={styles.recHint}>Hold the day</Text>
          ) : null}
        </View>
        {__DEV__ && !capture.recording && !capture.processing ? (
          <TouchableOpacity
            style={styles.devReplay}
            onPress={() => void devReplayLastTranscript()}
            testID="ambient-dev-replay"
          >
            <Icon name="repeat" size={13} color={colors.textMuted} />
            <Text style={styles.devReplayText}>DEV · replay last transcript</Text>
          </TouchableOpacity>
        ) : null}
        {/* Below the button: ask this day, or a fixed 1–2 line live caption while recording (constant
            height so streaming words never shove the button around). */}
        {capture.recording ? (
          <Text style={styles.liveCaption} numberOfLines={2} testID="ambient-live-transcript">
            {capture.liveTranscript || 'Listening…'}
          </Text>
        ) : (
          <TouchableOpacity
            style={styles.askbar}
            activeOpacity={0.7}
            onPress={() => setShowAsk(true)}
            testID="ambient-day-ask-open"
          >
            <Icon name="search" size={15} color={colors.textMuted} />
            <TextInput
              style={styles.askInput}
              placeholder="Ask this day…"
              placeholderTextColor={colors.textMuted}
              value={askQuery}
              onChangeText={setAskQuery}
              onFocus={() => setShowAsk(true)}
              onSubmitEditing={() => void runAsk(askQuery)}
              returnKeyType="search"
              testID="ambient-day-ask"
            />
            {asking ? <LoadingDots size={6} /> : null}
          </TouchableOpacity>
        )}
      </View>
      {/* Transcription source — pinned to the very bottom. Who transcribes now (Mac / this phone / nothing),
          and taps through to fix it when the Mac is wanted but offline. */}
      <TouchableOpacity
        style={styles.sourceBar}
        onPress={
          macWantedButOffline
            ? () => navigation.navigate('RemoteServers')
            : transcriptionSource === 'none'
              ? openModels
              : undefined
        }
        disabled={transcriptionSource !== 'none' && !macWantedButOffline}
        activeOpacity={transcriptionSource !== 'none' || macWantedButOffline ? 0.7 : 1}
        testID="ambient-transcription-source"
      >
        <Icon
          name={
            transcriptionSource === 'mac'
              ? 'airplay'
              : macWantedButOffline
                ? 'alert-circle'
                : transcriptionSource === 'local'
                  ? 'smartphone'
                  : 'alert-circle'
          }
          size={13}
          color={
            transcriptionSource === 'mac' || (transcriptionSource === 'local' && !macWantedButOffline)
              ? colors.primary
              : colors.textMuted
          }
        />
        <Text
          style={[
            styles.sourceBarText,
            (transcriptionSource === 'none' || macWantedButOffline) && styles.sourceBarTextMuted
          ]}
        >
          {transcriptionSource === 'mac'
            ? 'Transcribing on your Mac'
            : macWantedButOffline
              ? transcriptionSource === 'local'
                ? 'On this phone — your Mac isn’t connected, tap to fix'
                : 'Your Mac isn’t connected — tap to connect'
              : transcriptionSource === 'local'
                ? 'Transcribing on this phone'
                : 'No transcription set up — tap to set up'}
        </Text>
      </TouchableOpacity>

      {/* Ask your day — a slide-up Q&A thread (not a floating card), with source conversations + follow-ups. */}
      <Modal
        visible={showAsk}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAsk(false)}
      >
        <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={() => setShowAsk(false)} />
        <View style={styles.askSheet}>
          <View style={styles.sheetGrip} />
          <Text style={styles.sheetTitle}>Ask · {dayLabel(dayKey)}</Text>
          <ScrollView
            style={styles.askThread}
            contentContainerStyle={{ paddingBottom: SPACING.md }}
            showsVerticalScrollIndicator={false}
          >
            {askThread.length === 0 ? (
              <Text style={styles.muted}>Ask anything about this day — decisions, to-dos, who said what.</Text>
            ) : (
              askThread.map((turn, i) => (
                <View key={i} style={styles.askTurn}>
                  <Text style={styles.askQ}>{turn.q}</Text>
                  {turn.result ? (
                    <>
                      <Text style={styles.askA}>{answerText(turn.result)}</Text>
                      {turn.result.sources.length > 0 ? (
                        <View style={styles.askSources}>
                          {turn.result.sources.map(s => (
                            <TouchableOpacity
                              key={s.id}
                              style={styles.askSourceChip}
                              onPress={() => {
                                setShowAsk(false);
                                navigation.navigate('AmbientSession', { sessionId: s.id });
                              }}
                            >
                              <Icon name="corner-down-right" size={11} color={colors.primary} />
                              <Text style={styles.askSourceText} numberOfLines={1}>
                                {clock(s.startMs)} · {s.summary.title}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      ) : null}
                    </>
                  ) : (
                    <View style={styles.cardBusy}>
                      <LoadingDots size={6} />
                      <Text style={styles.muted}>Thinking…</Text>
                    </View>
                  )}
                </View>
              ))
            )}
          </ScrollView>
          <View style={styles.askbar}>
            <Icon name="search" size={15} color={colors.textMuted} />
            <TextInput
              style={styles.askInput}
              placeholder={askThread.length > 0 ? 'Ask a follow-up…' : 'Ask this day…'}
              placeholderTextColor={colors.textMuted}
              value={askQuery}
              onChangeText={setAskQuery}
              onSubmitEditing={() => void runAsk(askQuery)}
              returnKeyType="search"
              autoFocus
              testID="ambient-ask-input"
            />
            {asking ? <LoadingDots size={6} /> : null}
          </View>
        </View>
      </Modal>

      {/* Timeline — reference, off the main surface. */}
      <Modal
        visible={showTimeline}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowTimeline(false)}
      >
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <ScreenHeader title={`Timeline · ${dayLabel(dayKey)}`} onBack={() => setShowTimeline(false)} />
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            {includedDaySessions.length > 0 ? (
              <View style={[styles.card, styles.tlCardSpace]}>
                {includedDaySessions.map((session, i) => renderTimelineRow(session, false, i === 0))}
              </View>
            ) : null}

            {/* Set-aside conversations — overheard (ambient) or ones you removed. Kept + searchable,
                collapsed so they don't clutter the day, and their to-dos/journal/actions are excluded.
                Tap the + on any to add it back to your day (its derived items reappear). */}
            {excludedDaySessions.length > 0 ? (
              <>
                <TouchableOpacity
                  style={styles.ambientHeader}
                  onPress={() => setAmbientExpanded(v => !v)}
                  testID="ambient-bucket-toggle"
                >
                  <Icon name="volume-1" size={15} color={colors.textMuted} />
                  <Text style={styles.ambientHeaderLabel}>
                    Set aside · {excludedDaySessions.length}
                  </Text>
                  <Text style={styles.ambientHeaderHint} numberOfLines={1}>
                    overheard or removed — not in your day
                  </Text>
                  <Icon
                    name={ambientExpanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
                {ambientExpanded ? (
                  <View style={[styles.card, styles.tlCardSpace]}>
                    {excludedDaySessions.map((session, i) => renderTimelineRow(session, true, i === 0))}
                  </View>
                ) : null}
              </>
            ) : null}
            <View style={{ height: 20 }} />
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Recorder settings — config, behind the gear. */}
      <Modal
        visible={showSettings}
        animationType="slide"
        transparent
        onRequestClose={() => setShowSettings(false)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setShowSettings(false)}
        />
        <View style={styles.sheet}>
          <View style={styles.sheetGrip} />
          <Text style={styles.sheetTitle}>Recorder settings</Text>
          <ScrollView
            style={styles.settings}
            contentContainerStyle={{ paddingBottom: SPACING.md }}
            showsVerticalScrollIndicator={false}
            testID="ambient-day-settings"
          >
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>Listening</Text>
              <View style={styles.seg}>
                {(['session', 'always-on'] as const).map(mode => (
                  <TouchableOpacity
                    key={mode}
                    onPress={() => setCaptureMode(mode)}
                    style={[styles.segBtn, captureMode === mode && styles.segBtnOn]}
                    testID={`ambient-capture-${mode}`}
                  >
                    <Text style={[styles.segText, captureMode === mode && styles.segTextOn]}>
                      {mode === 'session' ? 'One tap' : 'Always-on'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <View style={[styles.settingRow, { marginTop: 14 }]}>
              <Text style={styles.settingLabel}>Processing</Text>
              <View style={styles.seg}>
                <TouchableOpacity
                  onPress={() => setProcessingMode('live')}
                  style={[styles.segBtn, processingMode === 'live' && styles.segBtnOn]}
                  testID="ambient-mode-live"
                >
                  <Text style={[styles.segText, processingMode === 'live' && styles.segTextOn]}>Live</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setProcessingMode('nightly')}
                  style={[styles.segBtn, processingMode === 'nightly' && styles.segBtnOn]}
                  testID="ambient-mode-nightly"
                >
                  <Text style={[styles.segText, processingMode === 'nightly' && styles.segTextOn]}>Later</Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.settingHint}>
              Live processes each recording on stop. Later queues them to process together.
            </Text>
            {processingMode === 'nightly' ? (
              <View style={{ marginTop: 12 }}>
                <ProcessingSchedulePicker
                  minuteOfDay={processingMinuteOfDay}
                  onChange={setProcessingMinuteOfDay}
                />
              </View>
            ) : null}
            <View style={[styles.settingRow, { marginTop: 14 }]}>
              <Text style={styles.settingLabel}>Keep summaries on-device</Text>
              <Switch
                value={onDeviceOnly}
                onValueChange={next => {
                  setOnDeviceOnly(next);
                  if (next) setUseMacForTranscription(false);
                }}
                trackColor={{ true: colors.primary, false: colors.border }}
                testID="ambient-day-privacy"
              />
            </View>
            <View style={[styles.settingRow, { marginTop: 14 }]}>
              <Text style={styles.settingLabel}>Transcribe on Mac when paired</Text>
              <Switch
                value={useMacForTranscription}
                onValueChange={next => {
                  setUseMacForTranscription(next);
                  if (next) setOnDeviceOnly(false);
                }}
                trackColor={{ true: colors.primary, false: colors.border }}
                testID="ambient-day-mac-offload"
              />
            </View>
            <View style={[styles.settingRow, { marginTop: 14 }]}>
              <Text style={styles.settingLabel}>Keep audio for Replay</Text>
              <View style={styles.seg}>
                {[7, 30].map(days => (
                  <TouchableOpacity
                    key={days}
                    onPress={() => setAudioRetentionDays(days)}
                    style={[styles.segBtn, audioRetentionDays === days && styles.segBtnOn]}
                    testID={`ambient-retention-${days}`}
                  >
                    <Text style={[styles.segText, audioRetentionDays === days && styles.segTextOn]}>{days}d</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            <TouchableOpacity
              style={[styles.settingRow, { marginTop: 14 }]}
              onPress={() => { setShowSettings(false); navigation.navigate('DayRecorderModels'); }}
              testID="ambient-recorder-models"
            >
              <Text style={styles.settingLabel}>Recorder models</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                <Text style={styles.presetChangeText}>Manage</Text>
                <Icon name="chevron-right" size={16} color={colors.primary} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.settingRow, { marginTop: 14 }]}
              disabled={daySessions.length === 0 || capture.processing}
              onPress={() => {
                setShowSettings(false);
                Alert.alert(
                  'Re-transcribe this day?',
                  `Re-runs transcription and summaries for all ${daySessions.length} conversation${daySessions.length === 1 ? '' : 's'} on ${dayLabel(dayKey)}, using your CURRENT transcription model — switch to a bigger model or connect your Mac first for a better result. This replaces the existing transcripts and summaries.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Re-transcribe', onPress: () => void reprocessDay(daySessions.map(s => s.id)) }
                  ]
                );
              }}
              testID="ambient-reprocess-day"
            >
              <Text style={[styles.settingLabel, daySessions.length === 0 && { color: colors.textMuted }]}>Re-transcribe this day</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                <Text style={styles.presetChangeText}>{daySessions.length} conv{daySessions.length === 1 ? '' : 's'}</Text>
                <Icon name="refresh-cw" size={15} color={colors.primary} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.settingRow, { marginTop: 14 }]}
              onPress={() => { setShowSettings(false); navigation.navigate(isPro ? 'ManageVoices' : 'ProDetail'); }}
              testID="ambient-add-voice"
            >
              <Text style={styles.settingLabel}>Voices</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.sm }}>
                <Text style={styles.presetChangeText}>Manage</Text>
                <Icon name="chevron-right" size={16} color={colors.primary} />
              </View>
            </TouchableOpacity>
            <TouchableOpacity style={styles.clearBtn} onPress={resetDay} testID="ambient-clear-all">
              <Icon name="trash-2" size={14} color={colors.error} />
              <Text style={styles.clearBtnText}>Clear all Day data</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function answerText(result: AskResult): string {
  switch (result.status) {
    case 'no-model':
      return 'Load a chat model (or select a remote one) to ask your day.';
    case 'no-matches':
      return 'Nothing in this day matches that.';
    case 'error':
      return 'Could not answer that.';
    default:
      return result.answer;
  }
}

function Section({
  title,
  count,
  icon,
  styles,
  colors,
  children
}: {
  title: string;
  count?: string;
  icon: string;
  styles: any;
  colors: any;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Icon name={icon} size={14} color={colors.primary} />
        <Text style={styles.sectionTitle}>{title}</Text>
        {count ? <Text style={styles.sectionCount}>{count}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function ActionCard({
  proposal,
  styles,
  onApprove,
  onDismiss
}: {
  proposal: ProactiveActionProposal;
  styles: any;
  onApprove: () => void;
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <View style={styles.action} testID="ambient-action">
      {proposal.connector ? (
        <Text style={styles.actionConn}>{proposal.connector.toUpperCase()}</Text>
      ) : null}
      <Text style={styles.actionTitle}>{proposal.title ?? 'Action'}</Text>
      {proposal.why ? <Text style={styles.actionWhy}>{proposal.why}</Text> : null}
      <View style={styles.actionBtns}>
        <TouchableOpacity style={styles.actionApprove} onPress={onApprove} testID="ambient-action-approve">
          <Text style={styles.actionApproveText}>Approve</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionDismiss} onPress={onDismiss} testID="ambient-action-dismiss">
          <Text style={styles.actionDismissText}>Dismiss</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const TASK_HIT = { top: 8, bottom: 8, left: 8, right: 8 };

function TaskRow({
  task,
  first,
  styles,
  colors,
  onToggle,
  onOpen,
  onEdit,
  onDelete
}: {
  task: DayTask;
  first?: boolean;
  styles: any;
  colors: any;
  onToggle: () => void;
  onOpen: () => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(task.text);
  const save = (): void => {
    const next = draft.trim();
    if (next && next !== task.text) onEdit(next);
    setEditing(false);
  };
  // A standalone to-do (e.g. a desktop CRM to-do) has no local session: it opens nothing, shows its
  // origin instead of a conversation, and is edited/deleted on the device that owns it — the phone only
  // ticks it. Its subtitle names where it came from.
  const isStandalone = Boolean(task.standaloneSource);
  const standaloneLabel =
    task.standaloneSource === 'desktop' ? 'From desktop' : 'Synced';
  // Expand to cite provenance: a recorder to-do shows its conversation (headline + a way into it); a
  // standalone to-do (e.g. a desktop CRM to-do) shows the detail blurb its authoring device sent. Both
  // ride in `sessionHeadline`; only a recorder one has a local session to open.
  const hasDetail = !!task.sessionHeadline;
  return (
    <View style={!first && styles.taskDivider} testID="ambient-task">
      <View style={styles.task}>
        <TouchableOpacity
          onPress={onToggle}
          style={[styles.box, task.done && styles.boxDone]}
          testID="ambient-task-box"
        >
          {task.done ? <Icon name="check" size={13} color={colors.background} /> : null}
        </TouchableOpacity>
        {editing ? (
          <TextInput
            style={styles.taskEditInput}
            value={draft}
            onChangeText={setDraft}
            autoFocus
            multiline
            onBlur={save}
            onSubmitEditing={save}
            blurOnSubmit
            returnKeyType="done"
            testID="ambient-task-edit-input"
          />
        ) : isStandalone ? (
          <TouchableOpacity
            style={styles.taskTx}
            onPress={() => hasDetail && setExpanded((e) => !e)}
            disabled={!hasDetail}
            testID="ambient-task-expand"
          >
            <View style={styles.taskLeadRow}>
              {hasDetail ? (
                <Icon
                  name={expanded ? 'chevron-down' : 'chevron-right'}
                  size={14}
                  color={colors.textMuted}
                  style={styles.taskChevron}
                />
              ) : null}
              <Text style={[styles.taskLead, task.done && styles.taskDone, styles.taskLeadFlex]}>
                {task.text}
              </Text>
            </View>
            <Text style={styles.taskSrc}>{standaloneLabel}</Text>
          </TouchableOpacity>
        ) : (
          // Tap toggles the inline detail when there's a conversation to cite; otherwise it opens the
          // session directly (nothing to expand). A chevron signals the expandable ones.
          <TouchableOpacity
            style={styles.taskTx}
            onPress={() => (hasDetail ? setExpanded((e) => !e) : onOpen())}
            testID="ambient-task-expand"
          >
            <View style={styles.taskLeadRow}>
              {hasDetail ? (
                <Icon
                  name={expanded ? 'chevron-down' : 'chevron-right'}
                  size={14}
                  color={colors.textMuted}
                  style={styles.taskChevron}
                />
              ) : null}
              <Text style={[styles.taskLead, task.done && styles.taskDone, styles.taskLeadFlex]}>
                {task.text}
              </Text>
            </View>
            <Text style={styles.taskSrc}>
              {clock(task.sessionStartMs)} · {task.sessionTitle}
            </Text>
          </TouchableOpacity>
        )}
        <View style={styles.taskActions}>
          {isStandalone ? null : editing ? (
            <TouchableOpacity onPress={save} hitSlop={TASK_HIT} testID="ambient-task-save">
              <Icon name="check" size={17} color={colors.primary} />
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => {
                  setDraft(task.text);
                  setEditing(true);
                }}
                hitSlop={TASK_HIT}
                testID="ambient-task-edit"
              >
                <Icon name="edit-2" size={15} color={colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity onPress={onDelete} hitSlop={TASK_HIT} testID="ambient-task-delete">
                <Icon name="trash-2" size={15} color={colors.textMuted} />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
      {expanded && hasDetail ? (
        <View style={styles.taskDetail} testID="ambient-task-detail">
          <Text style={styles.taskDetailBody}>{task.sessionHeadline}</Text>
          {!isStandalone ? (
            <TouchableOpacity style={styles.taskDetailOpen} onPress={onOpen}>
              <Text style={styles.taskDetailOpenText}>Open conversation</Text>
              <Icon name="arrow-up-right" size={13} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

// The record button while recording: an emerald pause button that gently pulses to signify live capture.
// Honors reduce-motion (static when the OS asks). Tap to stop.
function PulsingPauseButton({
  styles,
  colors,
  onPress
}: {
  styles: any;
  colors: any;
  onPress: () => void;
}): React.ReactElement {
  const scale = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => live && setReduceMotion(v));
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.12, duration: 700, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 700, useNativeDriver: true })
      ])
    );
    loop.start();
    return () => {
      live = false;
      loop.stop();
    };
  }, [scale, reduceMotion]);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <TouchableOpacity
        style={[styles.recBtn, styles.recBtnRec]}
        onPress={onPress}
        testID="ambient-day-stop"
        accessibilityLabel="Stop recording"
      >
        <Icon name="pause" size={24} color={colors.background} />
      </TouchableOpacity>
    </Animated.View>
  );
}

function PulseDot({ style }: { style: any }): React.ReactElement {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View style={[style, { opacity: pulse }]} />;
}

function CaptureStrip({
  styles,
  colors,
  capture,
  onReopen
}: {
  styles: any;
  colors: any;
  capture: ReturnType<typeof useAmbientCapture>;
  onReopen?: () => void;
}): React.ReactElement | null {
  if (capture.processing) {
    // Minimized ("Keep in background") processing — a live banner on the Day that reopens the full screen.
    return (
      <TouchableOpacity
        style={[styles.capStrip, styles.capProcessing]}
        onPress={onReopen}
        testID="ambient-processing-banner"
      >
        <LoadingDots size={6} />
        <Text style={styles.capText}>{progressLabel(capture.progress)}</Text>
        <Text style={styles.capReopen}>View</Text>
      </TouchableOpacity>
    );
  }
  if (!capture.recording) return null;
  return (
    <View style={[styles.capStrip, styles.capRecording]}>
      <PulseDot style={styles.capDot} />
      <Text style={styles.capText}>
        REC {mmss(capture.elapsedMs)} · {capture.liveCount} segment{capture.liveCount === 1 ? '' : 's'}
      </Text>
      <TouchableOpacity onPress={capture.flag} style={styles.capFlag} testID="ambient-day-flag">
        <Icon name="flag" size={14} color={colors.primary} />
        <Text style={styles.capFlagText}>{capture.flagCount > 0 ? capture.flagCount : 'Flag'}</Text>
      </TouchableOpacity>
    </View>
  );
}

function progressLabel(progress: ReturnType<typeof useAmbientCapture>['progress']): string {
  if (!progress) return 'Processing…';
  if (progress.phase === 'loading-model') return 'Loading summary model…';
  if (progress.phase === 'transcribing') {
    return `Transcribing ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`;
  }
  if (progress.phase === 'diarizing') {
    return `Recognizing speakers ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`;
  }
  return `Summarising ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`;
}

// Concept A — the recording takeover. Big clock, the transcript streaming phrase-by-phrase, the live
// level meter, and one emerald Pause. Emerald goes solid only on Pause (the one action in this state).
function RecordingView({
  styles,
  colors,
  capture,
  sourceLabel
}: {
  styles: any;
  colors: any;
  capture: ReturnType<typeof useAmbientCapture>;
  sourceLabel: string;
}): React.ReactElement {
  const scroll = useRef<ScrollView>(null);
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.recScreen}>
        <View style={styles.recStatusRow}>
          <View style={styles.recStatusLeft}>
            <PulseDot style={styles.recDot} />
            <Text style={styles.recStatusLabel}>RECORDING</Text>
          </View>
          <TouchableOpacity style={styles.recFlag} onPress={capture.flag} testID="ambient-day-flag">
            <Icon name="flag" size={13} color={colors.primary} />
            <Text style={styles.recFlagText}>{capture.flagCount > 0 ? String(capture.flagCount) : 'Flag'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.recTimer}>{hms(capture.elapsedMs)}</Text>
        <View style={styles.recDivider} />

        <Text style={styles.recSectionLabel}>LIVE TRANSCRIPT</Text>
        <ScrollView
          ref={scroll}
          style={styles.recTranscript}
          contentContainerStyle={styles.recTranscriptPad}
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
          testID="ambient-live-transcript"
        >
          <Text style={styles.recTranscriptText}>{capture.liveTranscript || 'Listening…'}</Text>
        </ScrollView>

        <View style={styles.recSpectrum}>
          <VoiceSpectrum active bars={21} height={34} />
        </View>

        <TouchableOpacity
          style={styles.recPause}
          onPress={capture.stop}
          testID="ambient-day-stop"
          accessibilityLabel="Pause recording"
        >
          <View style={styles.recPauseIcon}>
            <View style={styles.recPauseBar} />
            <View style={styles.recPauseBar} />
          </View>
          <Text style={styles.recPauseText}>Pause</Text>
        </TouchableOpacity>
        <Text style={styles.recSource}>{sourceLabel.toUpperCase()}</Text>
      </View>
    </SafeAreaView>
  );
}

// Concept: Processing. The pipeline we run after Pause, stated as staged work so it reads as honest
// on-device progress, not a spinner. The active stage carries the one 3-dot loader.
function stageStates(
  progress: ReturnType<typeof useAmbientCapture>['progress']
): { label: string; state: 'done' | 'now' | 'queued' }[] {
  let active = 0;
  if (progress) {
    if (progress.phase === 'transcribing') active = 0;
    else if (progress.phase === 'diarizing') active = 1;
    else if (progress.phase === 'loading-model' || progress.phase === 'summarizing') active = 2;
  }
  return ['Transcribing', 'Finding speakers', 'Summarising', 'Journal & to-dos'].map((label, i) => ({
    label,
    state: i < active ? 'done' : i === active ? 'now' : 'queued'
  }));
}

function ProcessingView({
  styles,
  colors,
  capture,
  onBackground
}: {
  styles: any;
  colors: any;
  capture: ReturnType<typeof useAmbientCapture>;
  onBackground: () => void;
}): React.ReactElement {
  const stages = stageStates(capture.progress);
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.procScreen}>
        <Text style={styles.procTitle}>Processing</Text>
        <View style={styles.recDivider} />
        <View style={styles.procStages}>
          {stages.map((st, i) => (
            <View key={st.label} style={[styles.procRow, i > 0 && styles.taskDivider]}>
              <View style={styles.procGlyph}>
                {st.state === 'done' ? (
                  <Icon name="check" size={14} color={colors.primary} />
                ) : st.state === 'now' ? (
                  <LoadingDots size={5} />
                ) : (
                  <View style={styles.procPending} />
                )}
              </View>
              <Text style={[styles.procLabel, st.state === 'queued' && styles.procLabelMuted]}>
                {st.label}
              </Text>
              <Text style={[styles.procState, st.state === 'now' && styles.procStateNow]}>
                {st.state}
              </Text>
            </View>
          ))}
        </View>
        <Text style={styles.procNote}>STAYS ON DEVICE</Text>
        <TouchableOpacity style={styles.procBg} onPress={onBackground} testID="ambient-processing-background">
          <Text style={styles.procBgText}>Keep in background</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors, shadows: ThemeShadows) {
  const RADIUS = SPACING.sm; // 8 — the single brand radius; no pills
  const RADIUS_XS = SPACING.xs; // 4 — checkbox/grip only
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    error: { ...TYPOGRAPHY.bodySmall, color: colors.error, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
    daynav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.md, paddingVertical: SPACING.sm },
    arrow: { padding: SPACING.xs },
    dayLabel: { ...TYPOGRAPHY.h2, color: colors.text, letterSpacing: 1, minWidth: 130, textAlign: 'center' },
    // capture strip
    capStrip: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderTopWidth: 1, borderBottomWidth: 1 },
    capRecording: { borderColor: colors.error },
    capProcessing: { borderColor: colors.border },
    capDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
    capText: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, flex: 1, fontVariant: ['tabular-nums'] },
    capReopen: { ...TYPOGRAPHY.label, color: colors.primary, letterSpacing: 1, textTransform: 'uppercase' },
    capFlag: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, borderWidth: 1, borderColor: colors.primary, borderRadius: RADIUS, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm },
    capFlagText: { ...TYPOGRAPHY.bodySmall, color: colors.primary },
    capStop: { borderWidth: 1, borderColor: colors.error, borderRadius: RADIUS, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
    capStopText: { ...TYPOGRAPHY.bodySmall, color: colors.error },
    // body
    body: { flex: 1 },
    bodyContent: { paddingBottom: SPACING.xl },
    empty: { padding: SPACING.lg, gap: SPACING.md },
    hero: { alignItems: 'center', paddingVertical: SPACING.xl, paddingHorizontal: SPACING.lg, gap: SPACING.md, borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, backgroundColor: colors.surface, ...shadows.small },
    heroIcon: { width: 56, height: 56, borderRadius: RADIUS, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.background },
    heroTitle: { ...TYPOGRAPHY.h2, color: colors.text, textAlign: 'center' },
    heroBody: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
    presetCard: { borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, backgroundColor: colors.surfaceLight, padding: SPACING.md, gap: SPACING.sm },
    presetHead: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 1.6, textTransform: 'uppercase' },
    presetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    presetKey: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
    presetVal: { ...TYPOGRAPHY.bodySmall, color: colors.text, fontVariant: ['tabular-nums'] },
    presetChange: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: SPACING.xs },
    presetChangeText: { ...TYPOGRAPHY.bodySmall, color: colors.primary },
    readyChip: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, alignSelf: 'flex-start', paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: RADIUS, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
    readyChipText: { ...TYPOGRAPHY.bodySmall, color: colors.primary },
    nudge: { borderWidth: 1, borderColor: colors.primary, borderRadius: RADIUS, backgroundColor: colors.surface, padding: SPACING.lg, gap: SPACING.sm, ...shadows.small },
    nudgeTitle: { ...TYPOGRAPHY.body, color: colors.text },
    nudgeBody: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, lineHeight: 18 },
    nudgeBtns: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
    nudgePrimary: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, backgroundColor: colors.primary, borderRadius: RADIUS, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
    nudgePrimaryText: { ...TYPOGRAPHY.bodySmall, color: colors.background },
    nudgeGhost: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, backgroundColor: colors.background },
    nudgeGhostText: { ...TYPOGRAPHY.bodySmall, color: colors.primary },
    muted: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
    // section
    section: { paddingTop: SPACING.lg },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
    // The shared brief card: surface tier on the background for depth (brand: tiered surfaces, not heavy
    // shadow), subtle border, minimal radius, one small theme shadow. Journal + To-do share it with Actions.
    card: { marginHorizontal: SPACING.lg, borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, backgroundColor: colors.surface, ...shadows.small, overflow: 'hidden' },
    cardPad: { padding: SPACING.md },
    sectionTitle: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 1.6, textTransform: 'uppercase' },
    sectionCount: { ...TYPOGRAPHY.label, color: colors.primary, marginLeft: 'auto', fontVariant: ['tabular-nums'] },
    journal: { ...TYPOGRAPHY.body, color: colors.text, lineHeight: 22 },
    cardBusy: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
    // task
    task: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.md, padding: SPACING.md },
    taskDivider: { borderTopWidth: 1, borderTopColor: colors.border },
    box: { width: 18, height: 18, borderRadius: RADIUS_XS, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    boxDone: { backgroundColor: colors.primary, borderColor: colors.primary },
    taskTx: { flex: 1 },
    taskActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, marginLeft: SPACING.sm },
    taskEditInput: { ...TYPOGRAPHY.body, color: colors.text, lineHeight: 19, flex: 1, padding: 0, borderBottomWidth: 1, borderBottomColor: colors.primary },
    taskLead: { ...TYPOGRAPHY.body, color: colors.text, lineHeight: 19 },
    taskDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
    taskSrc: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: SPACING.xs },
    taskLeadRow: { flexDirection: 'row', alignItems: 'flex-start' },
    taskChevron: { marginTop: 2, marginRight: SPACING.xs },
    taskLeadFlex: { flex: 1 },
    taskDetail: { paddingLeft: SPACING.md + 18 + SPACING.md, paddingRight: SPACING.md, paddingBottom: SPACING.md, gap: SPACING.sm },
    taskDetailBody: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted, lineHeight: 18 },
    taskDetailOpen: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
    taskDetailOpenText: { ...TYPOGRAPHY.label, color: colors.primary, textTransform: 'uppercase', letterSpacing: 1 },
    // action
    action: { marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, padding: SPACING.md, borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, backgroundColor: colors.surface, ...shadows.small },
    actionConn: { ...TYPOGRAPHY.labelSmall, color: colors.primary, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: SPACING.xs },
    actionTitle: { ...TYPOGRAPHY.bodySmall, color: colors.text, lineHeight: 18 },
    actionWhy: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: SPACING.xs, lineHeight: 16 },
    actionBtns: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.md },
    actionApprove: { backgroundColor: colors.primary, borderRadius: RADIUS, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
    actionApproveText: { ...TYPOGRAPHY.bodySmall, color: colors.background },
    actionDismiss: { borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
    actionDismissText: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
    // timeline
    tlCardSpace: { marginTop: SPACING.md },
    tcard: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.md },
    tcardTime: { ...TYPOGRAPHY.label, color: colors.primary, width: 42, fontVariant: ['tabular-nums'] },
    tcardMid: { flex: 1 },
    tcardTitle: { ...TYPOGRAPHY.bodySmall, color: colors.text },
    tcardHead: { ...TYPOGRAPHY.label, color: colors.textMuted },
    tcardPeople: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginTop: 3 },
    tcardPeopleText: { ...TYPOGRAPHY.label, color: colors.primary, flex: 1 },
    tcardAmbient: { opacity: 0.6 },
    // ambient (overheard) collapsible group
    ambientHeader: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
    ambientHeaderLabel: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 1.2, textTransform: 'uppercase' },
    ambientHeaderHint: { ...TYPOGRAPHY.label, color: colors.textMuted, flex: 1, opacity: 0.8 },
    // header icons
    headIcons: { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg },
    // timeline chip
    tlChip: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginHorizontal: SPACING.lg, marginTop: SPACING.lg, padding: SPACING.md, borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, backgroundColor: colors.surface, ...shadows.small },
    tlChipLabel: { ...TYPOGRAPHY.bodySmall, color: colors.text },
    tlChipN: { ...TYPOGRAPHY.label, color: colors.textMuted, flex: 1, textAlign: 'right' },
    // docked ask + record
    dock: { flexDirection: 'column', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm, paddingBottom: SPACING.sm, borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.background },
    askbar: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md, borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, backgroundColor: colors.surface },
    askInput: { ...TYPOGRAPHY.bodySmall, flex: 1, color: colors.text, padding: 0 },
    answer: { marginHorizontal: SPACING.lg, marginBottom: SPACING.sm, borderWidth: 1, borderLeftWidth: 2, borderColor: colors.border, borderLeftColor: colors.primary, borderRadius: RADIUS, padding: SPACING.md, backgroundColor: colors.surface },
    answerText: { ...TYPOGRAPHY.bodySmall, color: colors.text, lineHeight: 19 },
    // Ask-your-day slide-up sheet
    askSheet: { maxHeight: '80%', backgroundColor: colors.surface, borderTopLeftRadius: SPACING.lg, borderTopRightRadius: SPACING.lg, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl, paddingTop: SPACING.sm },
    askThread: { marginBottom: SPACING.md },
    askTurn: { marginBottom: SPACING.lg },
    askQ: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: SPACING.sm },
    askA: { ...TYPOGRAPHY.body, color: colors.text, lineHeight: 22 },
    askSources: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.md },
    askSourceChip: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs, backgroundColor: colors.background, maxWidth: '100%' },
    askSourceText: { ...TYPOGRAPHY.label, color: colors.primary, flexShrink: 1 },
    // Floating transcript card while recording: surface tier for depth (not shadow), quiet emerald meter.
    liveCard: { borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, padding: SPACING.md, backgroundColor: colors.surface, gap: SPACING.xs },
    liveHead: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
    liveLabel: { ...TYPOGRAPHY.labelSmall, color: colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
    // Reserve a constant 3-line height so the card never resizes as words stream in — otherwise the dock
    // (anchored at the bottom) grows upward and shoves the record button around. Stable height = stable button.
    liveText: { ...TYPOGRAPHY.bodySmall, color: colors.text, lineHeight: 18, height: 54 },
    // Fixed 1–2 line live caption under the record button. Constant height so streaming words never move
    // the button; centered + muted so it reads as a quiet caption, not a card.
    liveCaption: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, lineHeight: 18, height: 40, textAlign: 'center', paddingHorizontal: SPACING.sm },
    // pending
    pending: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginHorizontal: SPACING.md, marginTop: SPACING.sm, padding: SPACING.md, borderWidth: 1, borderColor: colors.primary, borderRadius: RADIUS, backgroundColor: colors.surface },
    pendingError: { borderColor: colors.error },
    pendingText: { ...TYPOGRAPHY.bodySmall, color: colors.text, flex: 1 },
    pendingCta: { ...TYPOGRAPHY.bodySmall, color: colors.primary },
    pendingCtaError: { color: colors.error },
    // Always-visible transcription-source bar above the dock
    sourceBar: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderTopWidth: 1, borderTopColor: colors.borderLight },
    sourceBarText: { ...TYPOGRAPHY.bodySmall, color: colors.primary },
    sourceBarTextMuted: { color: colors.textMuted },
    // settings sheet
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: { maxHeight: '85%', backgroundColor: colors.surface, borderTopLeftRadius: SPACING.lg, borderTopRightRadius: SPACING.lg, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl, paddingTop: SPACING.sm },
    sheetGrip: { width: 36, height: 4, borderRadius: RADIUS_XS, backgroundColor: colors.border, alignSelf: 'center', marginBottom: SPACING.md },
    sheetTitle: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: SPACING.md },
    settings: {},
    clearBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, marginTop: SPACING.lg, paddingVertical: SPACING.md, borderRadius: RADIUS, borderWidth: 1, borderColor: colors.error },
    clearBtnText: { ...TYPOGRAPHY.bodySmall, color: colors.error },
    settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.md },
    settingLabel: { ...TYPOGRAPHY.bodySmall, color: colors.text, flex: 1 },
    settingHint: { ...TYPOGRAPHY.meta, color: colors.textMuted, lineHeight: 16, marginTop: SPACING.sm },
    seg: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: RADIUS, overflow: 'hidden' },
    segBtn: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm },
    segBtnOn: { backgroundColor: colors.surfaceHover },
    segText: { ...TYPOGRAPHY.bodySmall, color: colors.textMuted },
    segTextOn: { color: colors.primary },
    // record fab (docked)
    // The one primary action, centered. Minimal 8px radius (no pill/circle), emerald = the single accent
    // for both record and pause (red is reserved for errors); the icon + the live card carry the state.
    recordRow: { alignItems: 'center', justifyContent: 'center', paddingTop: SPACING.xs },
    recBtn: { width: 56, height: 56, borderRadius: RADIUS, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadows.small },
    recBtnRec: { backgroundColor: colors.primary },
    recBtnBusy: { backgroundColor: colors.surfaceHover },
    recHint: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', marginTop: SPACING.sm },
    devReplay: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, marginTop: SPACING.sm, paddingVertical: SPACING.sm, borderWidth: 1, borderColor: colors.border, borderRadius: SPACING.sm, borderStyle: 'dashed' },
    devReplayText: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 0.5 },
    // Recording takeover (concept A)
    recScreen: { flex: 1, paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.lg },
    recStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    recStatusLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
    recDot: { width: 8, height: 8, borderRadius: RADIUS_XS / 2, backgroundColor: colors.primary },
    recStatusLabel: { ...TYPOGRAPHY.label, color: colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
    recFlag: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, borderWidth: 1, borderColor: colors.primary, borderRadius: RADIUS, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs },
    recFlagText: { ...TYPOGRAPHY.label, color: colors.primary },
    recTimer: { ...TYPOGRAPHY.display, fontSize: 44, lineHeight: 52, color: colors.text, fontVariant: ['tabular-nums'], marginTop: SPACING.lg },
    recDivider: { height: 1, backgroundColor: colors.border, marginVertical: SPACING.lg },
    recSectionLabel: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: SPACING.md },
    recTranscript: { flex: 1 },
    recTranscriptPad: { paddingBottom: SPACING.md },
    recTranscriptText: { ...TYPOGRAPHY.body, color: colors.text, lineHeight: 22 },
    recSpectrum: { alignItems: 'flex-start', marginVertical: SPACING.lg, height: 34, justifyContent: 'flex-end' },
    recPause: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm, height: 54, borderRadius: RADIUS, backgroundColor: colors.primary },
    recPauseIcon: { flexDirection: 'row', gap: 4 },
    recPauseBar: { width: 4, height: 14, backgroundColor: colors.background },
    recPauseText: { ...TYPOGRAPHY.body, color: colors.background, letterSpacing: 0.3 },
    recSource: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center', marginTop: SPACING.md },
    // Processing takeover (staged pipeline)
    procScreen: { flex: 1, paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.lg },
    procTitle: { ...TYPOGRAPHY.h2, color: colors.text },
    procStages: { marginTop: SPACING.xl },
    procRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.md },
    procGlyph: { width: 18, alignItems: 'center', justifyContent: 'center' },
    procPending: { width: 6, height: 6, borderRadius: 1, borderWidth: 1, borderColor: colors.textMuted },
    procLabel: { ...TYPOGRAPHY.body, color: colors.text, flex: 1 },
    procLabelMuted: { color: colors.textMuted },
    procState: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase' },
    procStateNow: { color: colors.primary },
    procNote: { ...TYPOGRAPHY.label, color: colors.textMuted, letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center', marginTop: 'auto', marginBottom: SPACING.md },
    procBg: { height: 48, borderRadius: RADIUS, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
    procBgText: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary }
  });
}

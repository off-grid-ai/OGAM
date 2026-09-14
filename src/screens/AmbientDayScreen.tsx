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
  ActivityIndicator,
  Animated,
  AppState,
  Modal,
  ScrollView,
  Share,
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
import { useAmbientCapture } from '../hooks/useAmbientCapture';
import { useAlwaysOnCapture } from '../hooks/useAlwaysOnCapture';
import { useAmbientTimelineStore } from '../stores/ambientTimelineStore';
import {
  collectDayTasks,
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
import { mobileSpeechInputPorts } from '../services/adapters/speech/mobileSpeechInputPorts';
import { macOffloadReady } from '../services/ambient/macSttExecutorFactory';
import { formatTodosForActions, formatCallsForActions } from '../services/ambient/actionsModel';
import { askDayWithDeviceLLM } from '../services/ambient/askDayFactory';
import type { AskResult } from '../services/ambient/askDay';
import type { TimelineSession } from '../services/ambient/timelineModel';
import type { ProactiveActionProposal } from '@offgrid/models';

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

export function AmbientDayScreen(): React.ReactElement {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const navigation = useNavigation<any>();
  const capture = useAmbientCapture();

  const sessions = useAmbientTimelineStore(s => s.sessions);
  const doneTaskIds = useAmbientTimelineStore(s => s.doneTaskIds);
  const journalByDay = useAmbientTimelineStore(s => s.journalByDay);
  const actionsByDay = useAmbientTimelineStore(s => s.actionsByDay);
  const toggleTask = useAmbientTimelineStore(s => s.toggleTask);
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
  const setAudioRetentionDays = useAmbientTimelineStore(s => s.setAudioRetentionDays);
  const captureMode = useAmbientTimelineStore(s => s.captureMode);
  const setCaptureMode = useAmbientTimelineStore(s => s.setCaptureMode);
  const { openSync } = useOpenSync();
  const [ready, setReady] = useState(() => ({
    stt: mobileSpeechInputPorts.transcriber.ready(),
    mac: macOffloadReady()
  }));
  const refreshReady = useCallback(() => {
    setReady({ stt: mobileSpeechInputPorts.transcriber.ready(), mac: macOffloadReady() });
  }, []);
  const openModels = useCallback(
    () => navigation.navigate('ModelsTab', { initialTab: 'transcription' }),
    [navigation]
  );
  useAlwaysOnCapture(capture, captureMode === 'always-on');

  const dayKeys = useMemo(() => dayKeysWithSessions(sessions, dateParts), [sessions]);
  const [dayIndex, setDayIndex] = useState(0);
  const dayKey = dayKeys[dayIndex] ?? todayKey();
  const daySessions = useMemo(
    () => sessionsForDay(sessions, dayKey, dateParts),
    [sessions, dayKey]
  );
  const doneSet = useMemo(() => new Set(doneTaskIds), [doneTaskIds]);
  const tasks = useMemo(() => collectDayTasks(daySessions, doneSet), [daySessions, doneSet]);
  const journal = journalByDay[dayKey];

  // Generate the day's journal once, when the day has conversations but no cached narrative.
  const journalRequested = useRef<Set<string>>(new Set());
  const [journalBusy, setJournalBusy] = useState(false);
  useEffect(() => {
    if (daySessions.length === 0 || journalByDay[dayKey] !== undefined) return;
    if (journalRequested.current.has(dayKey)) return;
    journalRequested.current.add(dayKey);
    setJournalBusy(true);
    journalForDay(
      daySessions.map(s => ({
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
  }, [dayKey, daySessions, journalByDay]);

  // Propose the day's actions once, when it has conversations but no cached proposals.
  const actionsRequested = useRef<Set<string>>(new Set());
  const [actionsBusy, setActionsBusy] = useState(false);
  const actions = actionsByDay[dayKey];
  useEffect(() => {
    if (daySessions.length === 0 || actionsByDay[dayKey] !== undefined) return;
    if (actionsRequested.current.has(dayKey)) return;
    actionsRequested.current.add(dayKey);
    setActionsBusy(true);
    proposeActionsForDay(
      {
        todos: formatTodosForActions(tasks),
        calls: formatCallsForActions(daySessions)
      },
      useAmbientTimelineStore.getState().onDeviceOnly
    )
      .then(res => useAmbientTimelineStore.getState().setDayActions(dayKey, res.proposals))
      .finally(() => setActionsBusy(false));
  }, [dayKey, daySessions, actionsByDay, tasks]);

  // Ask-your-day, scoped to the current day.
  const [askQuery, setAskQuery] = useState('');
  const [asking, setAsking] = useState(false);
  const [askResult, setAskResult] = useState<AskResult | null>(null);

  // Reference + config live off the main surface, one tap away.
  const [showTimeline, setShowTimeline] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const ask = useCallback(async () => {
    const question = askQuery.trim();
    if (!question || asking) return;
    setAsking(true);
    setAskResult(null);
    try {
      setAskResult(
        await askDayWithDeviceLLM(
          question,
          daySessions,
          clock,
          useAmbientTimelineStore.getState().onDeviceOnly
        )
      );
    } finally {
      setAsking(false);
    }
  }, [askQuery, asking, daySessions]);

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
  const scheduledInFlight = useRef(false);
  useEffect(() => {
    const tryScheduled = (): void => {
      if (scheduledInFlight.current) return;
      const st = useAmbientTimelineStore.getState();
      if (st.processingMode !== 'nightly') return;
      if (st.pendingCaptures.length === 0) return;
      if (!shouldRunScheduled(Date.now(), st.processingMinuteOfDay, st.lastScheduledProcessAt)) return;
      scheduledInFlight.current = true;
      capture
        .processPending()
        .then(() => {
          if (useAmbientTimelineStore.getState().pendingCaptures.length === 0) {
            useAmbientTimelineStore.getState().markScheduledProcess(Date.now());
          }
        })
        .catch(() => undefined)
        .finally(() => {
          scheduledInFlight.current = false;
        });
    };
    tryScheduled();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        tryScheduled();
        refreshReady();
      }
    });
    return () => sub.remove();
  }, [capture]);

  const open = openTaskCount(tasks);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Day"
        right={
          <View style={styles.headIcons}>
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

      <CaptureStrip styles={styles} colors={colors} capture={capture} />
      {capture.error ? <Text style={styles.error}>{capture.error}</Text> : null}
      {pendingCaptures.length > 0 && !capture.processing ? (
        <TouchableOpacity style={styles.pending} onPress={capture.processPending} testID="ambient-process-pending">
          <Icon name="clock" size={15} color={colors.primary} />
          <Text style={styles.pendingText}>
            {pendingCaptures.length} recording{pendingCaptures.length === 1 ? '' : 's'} waiting
          </Text>
          <Text style={styles.pendingCta}>Process now</Text>
        </TouchableOpacity>
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

            {ready.stt || ready.mac ? (
              <View style={styles.readyChip}>
                <Icon name="check-circle" size={15} color={colors.primary} />
                <Text style={styles.readyChipText}>
                  Transcription ready{ready.stt ? ' · on-device' : ' · via your Mac'}
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
          </View>
        ) : (
          <>
            <Section title="Journal" styles={styles} colors={colors} icon="book-open">
              {journal ? (
                <Text style={styles.journal} testID="ambient-journal">
                  {journal}
                </Text>
              ) : journalBusy ? (
                <Text style={styles.muted}>Writing your journal…</Text>
              ) : (
                <Text style={styles.muted}>No journal yet.</Text>
              )}
            </Section>

            <Section
              title="To do"
              count={open > 0 ? `${open} to do` : 'all clear'}
              styles={styles}
              colors={colors}
              icon="check-circle"
            >
              {tasks.length === 0 ? (
                <Text style={styles.muted}>No tasks came up.</Text>
              ) : (
                tasks.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    styles={styles}
                    colors={colors}
                    onToggle={() => toggleTask(task.id)}
                    onOpen={() => navigation.navigate('AmbientSession', { sessionId: task.sessionId })}
                  />
                ))
              )}
            </Section>

            {actionsBusy || (actions && actions.length > 0) ? (
              <Section
                title="Actions"
                count={actions && actions.length > 0 ? `${actions.length} to approve` : undefined}
                styles={styles}
                colors={colors}
                icon="zap"
              >
                {actionsBusy && !actions ? (
                  <Text style={styles.muted}>Looking for things it can do…</Text>
                ) : (
                  (actions ?? []).map((proposal, index) => (
                    <ActionCard
                      key={`${proposal.title ?? 'action'}-${index}`}
                      proposal={proposal}
                      styles={styles}
                      onApprove={() => {
                        Share.share({ message: actionShareText(proposal) }).catch(() => undefined);
                        resolveDayAction(dayKey, index);
                      }}
                      onDismiss={() => resolveDayAction(dayKey, index)}
                    />
                  ))
                )}
              </Section>
            ) : null}

            <TouchableOpacity
              style={styles.tlChip}
              onPress={() => setShowTimeline(true)}
              testID="ambient-open-timeline"
            >
              <Icon name="clock" size={15} color={colors.textMuted} />
              <Text style={styles.tlChipLabel}>Timeline</Text>
              <Text style={styles.tlChipN}>
                {daySessions.length} conversation{daySessions.length === 1 ? '' : 's'}
              </Text>
              <Icon name="chevron-right" size={16} color={colors.primary} />
            </TouchableOpacity>
            <View style={{ height: 16 }} />
          </>
        )}
      </ScrollView>

      {/* Docked: ask + record, always at the thumb. */}
      {askResult && !asking ? (
        <View style={styles.answer} testID="ambient-day-answer">
          <Text style={styles.answerText}>{answerText(askResult)}</Text>
        </View>
      ) : null}
      <View style={styles.dock}>
        <View style={styles.askbar}>
          <Icon name="search" size={15} color={colors.textMuted} />
          <TextInput
            style={styles.askInput}
            placeholder="Ask this day…"
            placeholderTextColor={colors.textMuted}
            value={askQuery}
            onChangeText={setAskQuery}
            onSubmitEditing={ask}
            returnKeyType="search"
            testID="ambient-day-ask"
          />
          {asking ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>
        {!capture.recording && !capture.processing ? (
          <TouchableOpacity style={styles.fab} onPress={capture.start} testID="ambient-day-record">
            <Icon name="mic" size={22} color={colors.background} />
          </TouchableOpacity>
        ) : null}
      </View>

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
            {daySessions.map(session => (
              <TouchableOpacity
                key={session.id}
                style={styles.tcard}
                onPress={() => {
                  setShowTimeline(false);
                  navigation.navigate('AmbientSession', { sessionId: session.id });
                }}
                testID="ambient-timeline-row"
              >
                <Text style={styles.tcardTime}>{clock(session.startMs)}</Text>
                <View style={styles.tcardMid}>
                  <Text style={styles.tcardTitle} numberOfLines={1}>
                    {session.summary.title}
                  </Text>
                  <Text style={styles.tcardHead} numberOfLines={1}>
                    {session.summary.headline || 'No summary'}
                  </Text>
                </View>
                <Icon name="chevron-right" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
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
          <View style={styles.settings} testID="ambient-day-settings">
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
          </View>
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

function actionShareText(proposal: ProactiveActionProposal): string {
  const title = proposal.title ?? 'Action';
  return proposal.why ? `${title} — ${proposal.why}` : title;
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

function TaskRow({
  task,
  styles,
  colors,
  onToggle,
  onOpen
}: {
  task: DayTask;
  styles: any;
  colors: any;
  onToggle: () => void;
  onOpen: () => void;
}): React.ReactElement {
  return (
    <View style={styles.task} testID="ambient-task">
      <TouchableOpacity onPress={onToggle} style={styles.box} testID="ambient-task-box">
        {task.done ? <Icon name="check" size={13} color={colors.background} /> : null}
      </TouchableOpacity>
      <TouchableOpacity style={styles.taskTx} onPress={onOpen}>
        <Text style={[styles.taskLead, task.done && styles.taskDone]}>{task.text}</Text>
        <Text style={styles.taskSrc}>
          {clock(task.sessionStartMs)} · {task.sessionTitle}
        </Text>
      </TouchableOpacity>
    </View>
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
  capture
}: {
  styles: any;
  colors: any;
  capture: ReturnType<typeof useAmbientCapture>;
}): React.ReactElement | null {
  if (capture.processing) {
    return (
      <View style={[styles.capStrip, styles.capProcessing]}>
        <ActivityIndicator size="small" color={colors.primary} />
        <Text style={styles.capText}>{progressLabel(capture.progress)}</Text>
      </View>
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
      <TouchableOpacity onPress={capture.stop} style={styles.capStop} testID="ambient-day-stop">
        <Text style={styles.capStopText}>Stop</Text>
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
  return `Summarising ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`;
}

function createStyles(colors: ThemeColors, shadows: ThemeShadows) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    error: { color: colors.error, fontSize: 13, paddingHorizontal: 16, paddingBottom: 8 },
    daynav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingVertical: 6 },
    arrow: { padding: 4 },
    dayLabel: { color: colors.text, fontSize: 16, fontWeight: '700', letterSpacing: 1, minWidth: 130, textAlign: 'center' },
    // capture strip
    capStrip: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1 },
    capRecording: { borderColor: colors.error },
    capProcessing: { borderColor: colors.border },
    capDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.error },
    capText: { color: colors.textSecondary, fontSize: 12.5, flex: 1, fontVariant: ['tabular-nums'] },
    capFlag: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: colors.primary, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
    capFlagText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
    capStop: { borderWidth: 1, borderColor: colors.error, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 6 },
    capStopText: { color: colors.error, fontSize: 12, fontWeight: '700' },
    // body
    body: { flex: 1 },
    bodyContent: { paddingBottom: 24 },
    empty: { padding: 20, gap: 14 },
    hero: { alignItems: 'center', paddingVertical: 24, paddingHorizontal: 18, gap: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface, ...shadows.medium },
    heroIcon: { width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.background, ...shadows.glow },
    heroTitle: { color: colors.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center' },
    heroBody: { color: colors.textSecondary, fontSize: 13.5, lineHeight: 20, textAlign: 'center', maxWidth: 300 },
    presetCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, backgroundColor: colors.surfaceLight, padding: 14, gap: 10, ...shadows.small },
    presetHead: { color: colors.textMuted, fontSize: 10.5, letterSpacing: 1.6, fontWeight: '700' },
    presetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    presetKey: { color: colors.textSecondary, fontSize: 13 },
    presetVal: { color: colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
    presetChange: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    presetChangeText: { color: colors.primary, fontSize: 12.5, fontWeight: '700' },
    readyChip: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingHorizontal: 13, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, backgroundColor: 'rgba(52,211,153,0.10)' },
    readyChipText: { color: colors.primary, fontSize: 12.5, fontWeight: '700' },
    nudge: { borderWidth: 1, borderColor: colors.primary, borderRadius: 14, backgroundColor: colors.surface, padding: 16, gap: 8, ...shadows.small },
    nudgeTitle: { color: colors.text, fontSize: 14.5, fontWeight: '800' },
    nudgeBody: { color: colors.textMuted, fontSize: 12.5, lineHeight: 18 },
    nudgeBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
    nudgePrimary: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.primary, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 10, ...shadows.glow },
    nudgePrimaryText: { color: colors.background, fontSize: 12.5, fontWeight: '800' },
    nudgeGhost: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.background },
    nudgeGhostText: { color: colors.primary, fontSize: 12.5, fontWeight: '700' },
    muted: { color: colors.textMuted, fontSize: 13, paddingHorizontal: 18 },
    // section
    section: { paddingTop: 18 },
    sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingBottom: 10 },
    sectionTitle: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase' },
    sectionCount: { color: colors.primary, fontSize: 11, marginLeft: 'auto' },
    journal: { color: colors.text, fontSize: 14, lineHeight: 22, paddingHorizontal: 18 },
    // task
    task: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, paddingHorizontal: 18, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
    box: { width: 19, height: 19, borderRadius: 5, borderWidth: 1.5, borderColor: colors.textMuted, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    taskTx: { flex: 1 },
    taskLead: { color: colors.text, fontSize: 14, lineHeight: 19 },
    taskDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
    taskSrc: { color: colors.textMuted, fontSize: 10.5, marginTop: 3 },
    // action
    action: { marginHorizontal: 14, marginBottom: 8, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 9, backgroundColor: colors.surface, ...shadows.small },
    actionConn: { color: colors.primary, fontSize: 9.5, letterSpacing: 1.4, fontWeight: '700', marginBottom: 5 },
    actionTitle: { color: colors.text, fontSize: 13.5, fontWeight: '600', lineHeight: 18 },
    actionWhy: { color: colors.textMuted, fontSize: 11.5, marginTop: 4, lineHeight: 16 },
    actionBtns: { flexDirection: 'row', gap: 8, marginTop: 11 },
    actionApprove: { backgroundColor: colors.primary, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 7 },
    actionApproveText: { color: colors.background, fontSize: 12, fontWeight: '700' },
    actionDismiss: { borderWidth: 1, borderColor: colors.border, borderRadius: 6, paddingHorizontal: 14, paddingVertical: 7 },
    actionDismissText: { color: colors.textSecondary, fontSize: 12, fontWeight: '700' },
    // timeline
    tcard: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 18, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.border },
    tcardTime: { color: colors.primary, fontSize: 11, fontWeight: '700', width: 42, fontVariant: ['tabular-nums'] },
    tcardMid: { flex: 1 },
    tcardTitle: { color: colors.text, fontSize: 13.5, fontWeight: '600' },
    tcardHead: { color: colors.textMuted, fontSize: 11 },
    // ask
    // header icons
    headIcons: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    // timeline chip
    tlChip: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 18, marginTop: 4, padding: 13, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface, ...shadows.small },
    tlChipLabel: { color: colors.text, fontSize: 12.5, fontWeight: '600' },
    tlChipN: { color: colors.textMuted, fontSize: 11, flex: 1, textAlign: 'right' },
    // docked ask + record
    dock: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, borderTopWidth: 1, borderTopColor: colors.borderLight, backgroundColor: colors.background, boxShadow: '0px -3px 14px 0px rgba(0,0,0,0.28)' },
    askbar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderColor: colors.border, borderRadius: 22, backgroundColor: colors.surface },
    askInput: { flex: 1, color: colors.text, fontSize: 13, padding: 0 },
    answer: { marginHorizontal: 14, marginBottom: 8, borderWidth: 1, borderLeftWidth: 2, borderColor: colors.border, borderLeftColor: colors.primary, borderRadius: 8, padding: 12, backgroundColor: colors.surface },
    answerText: { color: colors.text, fontSize: 13, lineHeight: 19 },
    // pending
    pending: { flexDirection: 'row', alignItems: 'center', gap: 9, marginHorizontal: 12, marginTop: 8, padding: 11, borderWidth: 1, borderColor: colors.primary, borderRadius: 8, backgroundColor: colors.surface },
    pendingText: { color: colors.text, fontSize: 12.5, flex: 1 },
    pendingCta: { color: colors.primary, fontSize: 12, fontWeight: '700' },
    // settings sheet
    sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
    sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: 20, paddingBottom: 34, paddingTop: 8 },
    sheetGrip: { width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 14 },
    sheetTitle: { color: colors.textMuted, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '700', marginBottom: 12 },
    settings: {},
    settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    settingLabel: { color: colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
    settingHint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 6 },
    seg: { flexDirection: 'row', borderWidth: 1, borderColor: colors.border, borderRadius: 6, overflow: 'hidden' },
    segBtn: { paddingHorizontal: 13, paddingVertical: 6 },
    segBtnOn: { backgroundColor: 'rgba(52,211,153,0.14)' },
    segText: { color: colors.textMuted, fontSize: 12 },
    segTextOn: { color: colors.primary, fontWeight: '700' },
    // record fab (docked)
    fab: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', ...shadows.glow }
  });
}

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StatusBar, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useUiModeStore } from '../stores/uiModeStore';
import { useChatStore } from '../stores/chatStore';
import { useAgentStore } from '../stores/agentStore';
import { audioRecorderService } from '../services/audioRecorderService';
import { useAtlasVoiceStore } from './store';
import { stop as stopSpeech, setEarpieceRoute } from './tts';
import { BargeInDetector } from './bargeIn';
import { CALL_END_OF_SPEECH, EndOfSpeechDetector } from './endOfSpeech';
import { describeTurn, nextTimes, rememberCallTiming, type TurnEvent, type TurnTimes } from './turnTiming';
import logger from '../utils/logger';


/** mm:ss (or h:mm:ss) like a phone's call timer. */
export function formatCallTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = String(seconds % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Status line and talk-button icon for the call screen, highest-priority state last. */
export function callStatus(p: {
  handsFree: boolean; muted: boolean; isModelLoading?: boolean; isRecording?: boolean; isTranscribing?: boolean;
  isGenerating?: boolean; speakingKey: string | null; callerName: string;
}): { status: string; icon: string } {
  if (p.speakingKey) return { status: `${p.callerName} is speaking... talk or tap to interrupt`, icon: 'volume-x' };
  if (p.isGenerating) return { status: 'Thinking... tap to stop', icon: 'pause' };
  if (p.isTranscribing) return { status: 'Writing down what you said...', icon: 'mic' };
  if (p.isRecording) return { status: 'Listening... it answers when you stop talking', icon: 'square' };
  if (p.isModelLoading) return { status: 'Loading speech model...', icon: 'mic' };
  if (p.muted) return { status: 'Muted', icon: 'mic' };
  return { status: p.handsFree ? 'Tap to talk. It listens again after each answer.' : 'Tap to talk.', icon: 'mic' };
}

/** Who is "on the line": the conversation's agent, else the active agent, else Atlas. */
function useCallerName(): string {
  return useChatStore((s) => {
    const conv = s.conversations.find((c) => c.id === s.activeConversationId);
    const agents = useAgentStore.getState();
    return agents.getAgent(conv?.agentId ?? agents.activeAgentId)?.name ?? 'Atlas';
  });
}

/**
 * Voice ("phone call") mode, shown as a full-screen call. Tap the big button to talk; in
 * hands-free mode it stops by itself when you go quiet, sends, reads the answer aloud, then
 * listens again. Mute stops listening until it is turned off; End call returns to typing.
 */
export function AtlasAudioInput(props: any) {
  const {
    onStartRecording, onStopRecording, onCancelRecording, onStop,
    isRecording, isTranscribing, isModelLoading, isGenerating, voiceAvailable, partialResult, error, disabled,
  } = props;
  const { colors } = useTheme();
  const handsFree = useAtlasVoiceStore((s) => s.handsFree);
  const setHandsFree = useAtlasVoiceStore((s) => s.setHandsFree);
  const speakingKey = useAtlasVoiceStore((s) => s.speakingKey);
  const doneTick = useAtlasVoiceStore((s) => s.doneTick);
  const setMode = useUiModeStore((s) => s.setInterfaceMode);
  const earpiece = useAtlasVoiceStore((s) => s.earpiece);
  const setEarpiece = useAtlasVoiceStore((s) => s.setEarpiece);
  const [note, setNote] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const callerName = useCallerName();
  // Where the time of the last turn went (see turnTiming.ts): shown under the status and logged.
  const times = useRef<TurnTimes>({});
  const [timing, setTiming] = useState<string | null>(null);
  const mark = (event: TurnEvent) => {
    times.current = nextTimes(times.current, event, Date.now());
    const text = describeTurn(times.current);
    if (text && text !== timing) { logger.log(`[CALL-LAT] ${text}`); rememberCallTiming(text); setTiming(text); }
  };
  const wasRecording = useRef(false);
  useEffect(() => { if (wasRecording.current && !isRecording) mark('stopped'); wasRecording.current = !!isRecording; }, [isRecording]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (isGenerating) mark('sent'); }, [isGenerating]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (speakingKey) mark('voice'); }, [speakingKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // Earpiece ("phone call") output only while voice mode is open; normal speaker everywhere else.
  useEffect(() => {
    setEarpieceRoute(earpiece);
    return () => setEarpieceRoute(false);
  }, [earpiece]);

  const latest = useRef(props);
  latest.current = props;
  // The turn ends by itself when the person stops talking (like a real call): see endOfSpeech.ts.
  const vad = useRef<EndOfSpeechDetector | null>(null);

  // Mic loudness -> decide when the person has finished talking, so nobody has to tap to send.
  useEffect(() => {
    audioRecorderService.setLevelListener((rms) => {
      // While an answer is being spoken, the mic is only metered for barge-in.
      const watch = bargeIn.current;
      if (watch) {
        if (watch.push(rms)) interrupt();
        return;
      }
      if (!latest.current.isRecording) return;
      const verdict = vad.current?.push(rms, Date.now());
      if (verdict === 'end') latest.current.onStopRecording?.();
      else if (verdict === 'nothing') {
        latest.current.onCancelRecording?.();
        setNote('Paused - tap the button when you want to talk.');
      }
    });
    return () => audioRecorderService.setLevelListener(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- reads live state through refs

  // Barge-in: in hands-free mode the mic is metered while the answer plays; if the user talks
  // over it, speech stops and a fresh turn starts (so the answer's echo is never transcribed).
  const bargeIn = useRef<BargeInDetector | null>(null);
  const endBargeIn = () => {
    if (!bargeIn.current) return;
    bargeIn.current = null;
    audioRecorderService.cancelRecording();
  };
  const interrupt = () => {
    endBargeIn();
    stopSpeech();
    setTimeout(() => latest.current.onStartRecording?.(), 150);
  };
  useEffect(() => {
    const p = latest.current;
    if (!speakingKey || !handsFree || muted || !p.voiceAvailable || p.isRecording) return;
    const detector = new BargeInDetector();
    bargeIn.current = detector;
    audioRecorderService.startRecording()
      .then(() => { if (bargeIn.current !== detector) audioRecorderService.cancelRecording(); }) // answer already over
      .catch(() => { if (bargeIn.current === detector) bargeIn.current = null; });
    return endBargeIn;
  }, [speakingKey, handsFree, muted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset the silence detector at the start of every recording. If the microphone reports no
  // loudness (some phones, or the phone's own recognizer which ends turns itself), say so.
  useEffect(() => {
    if (!isRecording) return;
    vad.current = new EndOfSpeechDetector(Date.now(), CALL_END_OF_SPEECH);
    const t = setTimeout(() => {
      if (vad.current?.levels || !latest.current.isRecording || !audioRecorderService.isCurrentlyRecording()) return;
      logger.warn('[CALL] no microphone levels: automatic end of turn unavailable on this recording');
      setNote('Tap the button when you finish talking.');
    }, 2500);
    return () => clearTimeout(t);
  }, [isRecording]);

  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  // A call is live as soon as it opens: in hands-free mode start listening straight away.
  useEffect(() => {
    const p = latest.current;
    if (handsFree && p.voiceAvailable && !p.isRecording && !p.isGenerating && !p.disabled) p.onStartRecording?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, when the call opens

  // Hands-free loop: when a spoken answer finishes, open the mic again.
  const firstTick = useRef(doneTick);
  useEffect(() => {
    if (doneTick === firstTick.current) return;
    const p = latest.current;
    if (!handsFree || mutedRef.current || !p.voiceAvailable || p.isRecording || p.isGenerating || p.isTranscribing) return;
    const t = setTimeout(() => { setNote(null); latest.current.onStartRecording?.(); }, 250);
    return () => clearTimeout(t);
  }, [doneTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (next && isRecording) onCancelRecording?.();
    setNote(next ? 'Muted - Atlas is not listening.' : null);
  };

  const endCall = () => {
    stopSpeech();
    if (isRecording) onCancelRecording?.();
    setMode('chat');
  };

  const press = () => {
    setNote(null);
    if (muted) setMuted(false);
    if (speakingKey) { stopSpeech(); return; }
    if (isRecording) { onStopRecording?.(); return; }
    if (isGenerating) { onStop?.(); return; }
    if (!voiceAvailable) {
      setNote("To talk, download a speech-to-text (Whisper) model in the Models screen, or install your phone's speech recognition (Google speech / Gboard voice typing) with its offline language. Answers can still be read aloud.");
      return;
    }
    onStartRecording?.();
  };

  const { status, icon } = callStatus({ handsFree, muted, isModelLoading, isRecording, isTranscribing, isGenerating, speakingKey, callerName });
  const busy = isTranscribing || isModelLoading;
  const initial = callerName.trim().charAt(0).toUpperCase() || 'A';

  const roundButton = (opts: { icon: string; label: string; active?: boolean; onPress: () => void; testID: string }) => (
    <TouchableOpacity
      testID={opts.testID}
      onPress={opts.onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!opts.active }}
      accessibilityLabel={opts.label}
      style={styles.control}
    >
      <View style={[styles.round, { backgroundColor: opts.active ? colors.text : colors.surface, borderColor: colors.border }]}>
        <Icon name={opts.icon} size={24} color={opts.active ? colors.background : colors.text} />
      </View>
      <Text style={[styles.controlLabel, { color: colors.textSecondary }]}>{opts.label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible animationType="slide" onRequestClose={endCall} statusBarTranslucent>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} testID="voice-call-screen">
        <View style={styles.caller}>
          <View style={[styles.avatar, { backgroundColor: colors.surface, borderColor: speakingKey || isRecording ? colors.primary : colors.border }]}>
            <Text style={[styles.avatarText, { color: colors.text }]}>{initial}</Text>
          </View>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{callerName}</Text>
          <Text style={[styles.timer, { color: colors.textSecondary }]} testID="voice-call-timer">{formatCallTime(elapsed)}</Text>
          <Text style={[styles.status, { color: colors.textSecondary }]}>{note ?? (error ? String(error) : status)}</Text>
          {!!timing && <Text style={[styles.timing, { color: colors.textMuted }]} testID="voice-call-timing">{timing}</Text>}
          {!!partialResult && isRecording && (
            <Text style={[styles.caption, { color: colors.text }]} numberOfLines={3}>{partialResult}</Text>
          )}
        </View>

        <View style={styles.controls}>
          {roundButton({ icon: muted ? 'mic-off' : 'mic', label: muted ? 'Unmute' : 'Mute', active: muted, onPress: toggleMute, testID: 'voice-call-mute' })}
          {roundButton({ icon: earpiece ? 'phone' : 'volume-2', label: earpiece ? 'Earpiece' : 'Speaker', active: !earpiece, onPress: () => setEarpiece(!earpiece), testID: 'voice-call-speaker' })}
          {roundButton({ icon: 'repeat', label: 'Hands-free', active: handsFree, onPress: () => setHandsFree(!handsFree), testID: 'voice-call-handsfree' })}
        </View>

        <View style={styles.bottom}>
          <TouchableOpacity
            onPress={press}
            disabled={disabled && !isGenerating && !speakingKey}
            style={[styles.talk, { backgroundColor: isRecording ? colors.error : colors.primary }]}
            accessibilityLabel="Talk"
            testID="voice-call-talk"
          >
            {busy ? <ActivityIndicator color={colors.background} /> : <Icon name={icon} size={30} color={colors.background} />}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={endCall}
            style={[styles.end, { backgroundColor: colors.error }]}
            accessibilityLabel="End call"
            testID="voice-call-end"
          >
            <Icon name="phone-off" size={28} color={colors.background} />
          </TouchableOpacity>
          <Text style={[styles.controlLabel, { color: colors.textSecondary }]}>End call</Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'space-between', paddingHorizontal: SPACING.xl },
  caller: { alignItems: 'center', paddingTop: SPACING.xxl * 2 },
  avatar: { width: 112, height: 112, borderRadius: 56, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...TYPOGRAPHY.display },
  name: { ...TYPOGRAPHY.h1, marginTop: SPACING.lg },
  timer: { ...TYPOGRAPHY.body, marginTop: SPACING.xs },
  status: { ...TYPOGRAPHY.bodySmall, marginTop: SPACING.md, textAlign: 'center' },
  timing: { ...TYPOGRAPHY.meta, marginTop: SPACING.xs, textAlign: 'center' },
  caption: { ...TYPOGRAPHY.body, marginTop: SPACING.md, textAlign: 'center' },
  controls: { flexDirection: 'row', justifyContent: 'space-around' },
  control: { alignItems: 'center', width: 96 },
  round: { width: 64, height: 64, borderRadius: 32, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  controlLabel: { ...TYPOGRAPHY.meta, marginTop: SPACING.xs },
  bottom: { alignItems: 'center', paddingBottom: SPACING.xxl },
  talk: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.xl },
  end: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});

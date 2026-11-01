import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { Button } from '../components/Button';
import { ForceLoadModel } from '../components/ForceLoadModel';
import { formatCallTime } from '../atlasVoice/AudioInput';
import { keepScreenOn } from '../atlasVoice/tts';
import { LANGUAGES, languageService } from './languageService';
import { useLanguage } from './store';
import { SCENARIOS, customScenario, type Scenario, type Turn } from './phoneCall';
import { createCall, type Call, type CallState } from './callService';
import { createStyles } from './CallScreen.styles';
import { Tappable } from './Tappable';
import { speakVaried } from './voices';

const STATUS: Record<CallState['phase'], string> = {
  ringing: 'Ringing...',
  speaking: 'Talking... tap the microphone to interrupt',
  thinking: 'Thinking...',
  listening: 'Listening... talk, and it sends when you pause',
  transcribing: 'Writing down what you said...',
  idle: 'Tap the microphone to speak',
  ended: 'Call ended',
};

/** Follows a call's state; the call (callService) owns everything, this only re-renders. */
function useCallState(call: Call | null): CallState | null {
  const [, tick] = useState(0);
  useEffect(() => call?.subscribe(() => tick((n) => n + 1)), [call]);
  return call?.state() ?? null;
}

/** One line of the call. The caller's lines are tappable words, or hidden until tapped when captions are off. */
function Bubble({ turn, index, hidden, onReveal }: { turn: Turn; index: number; hidden: boolean; onReveal: () => void }) {
  const styles = useThemedStyles(createStyles);
  const theirs = turn.who === 'them';
  let body: React.ReactNode = <Text style={styles.bubbleText}>{turn.text}</Text>;
  if (theirs) body = <Tappable text={turn.text} style={styles.bubbleText as any} />;
  if (hidden) body = <TouchableOpacity onPress={onReveal} testID={`call-reveal-${index}`} accessibilityLabel="Show what they said"><Text style={styles.roman}>Tap to read this line</Text></TouchableOpacity>;
  return <View style={[styles.bubble, theirs ? styles.bubbleTheirs : styles.bubbleMine]}>{body}</View>;
}

/** The suggested line from "What do I say?": hear it, tap its words, see what it means. */
function HintBox({ hint, code }: { hint: { say: string; en: string }; code: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.hint} testID="call-hint">
      <Text style={styles.prompt}>You could say</Text>
      <View style={styles.sayRow}>
        <TouchableOpacity onPress={() => speakVaried(hint.say, code, 'call-hint')} accessibilityLabel="Hear the hint"><Icon name="volume-2" size={22} color={colors.primary} /></TouchableOpacity>
        <View style={styles.sayText}><Tappable text={hint.say} style={styles.bubbleText as any} /></View>
      </View>
      {!!hint.en && <Text style={styles.meta}>{hint.en}</Text>}
    </View>
  );
}

/** Pick a situation (or describe your own) for a practice call. */
function Setup({ onStart }: { onStart: (s: Scenario) => void }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [own, setOwn] = useState('');
  return (
    <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Text style={styles.prompt}>Who are you calling?</Text>
      {SCENARIOS.map((s) => (
        <TouchableOpacity key={s.id} style={styles.scenario} onPress={() => onStart(s)} testID={`call-scenario-${s.id}`} accessibilityLabel={`Call: ${s.title}`}>
          <Icon name={s.icon} size={22} color={colors.primary} />
          <View style={styles.scenarioText}>
            <Text style={styles.bubbleText}>{s.title}</Text>
            <Text style={styles.meta}>You {s.goal}.</Text>
          </View>
        </TouchableOpacity>
      ))}
      <Text style={styles.prompt}>Or describe your own</Text>
      <TextInput value={own} onChangeText={setOwn} placeholder="Calling a plumber about a leak" placeholderTextColor={colors.textMuted}
        style={styles.typed} testID="call-own" />
      <Button title="Call" disabled={!own.trim()} onPress={() => onStart(customScenario(own))} testID="call-own-start" />
    </ScrollView>
  );
}

/** What went wrong in the learner's lines, once the call is over. */
function Review({ state, onDone }: { state: CallState; onDone: () => void }) {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const list = state.corrections;
  return (
    <ScrollView contentContainerStyle={styles.body} testID="call-review">
      <Text style={styles.big}>{state.passed ? 'Nice call.' : 'Call ended.'}</Text>
      {list === null && <ActivityIndicator color={colors.primary} />}
      {list !== null && !list.length && <Text style={styles.bodyText}>{state.turns.some((t) => t.who === 'me') ? 'No mistakes to fix.' : 'You did not say anything this time.'}</Text>}
      {!!list?.length && <Text style={styles.prompt}>Say it like this next time</Text>}
      {list?.map((c) => (
        <View key={`${c.said}|${c.fixed}`} style={styles.fix}>
          <Text style={styles.roman}>{c.said}</Text>
          <Tappable text={c.fixed} style={styles.bodyText as any} />
          {!!c.why && <Text style={styles.meta}>{c.why}</Text>}
        </View>
      ))}
      {!!state.note && <Text style={styles.meta}>{state.note}</Text>}
      <Button title="Done" onPress={onDone} testID="call-done" />
    </ScrollView>
  );
}

/** The round buttons of a live call: captions, talk (it also sends by itself when you pause), a hint, and the big red End call. */
function CallControls({ call, listening, captions }: { call: Call; listening: boolean; captions: boolean }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <>
    <View style={styles.controls}>
      <View style={styles.control}>
        <TouchableOpacity style={styles.round} onPress={() => languageService.setCaptions(!captions)} testID="call-captions" accessibilityLabel={captions ? 'Captions on' : 'Captions off'}>
          <Icon name={captions ? 'type' : 'eye-off'} size={24} color={captions ? colors.primary : colors.textMuted} />
        </TouchableOpacity>
        <Text style={styles.controlLabel}>Captions</Text>
      </View>
      <View style={styles.control}>
        <TouchableOpacity style={[styles.talk, listening && styles.talkOn]} onPress={() => (listening ? call.doneTalking() : call.talk())}
          testID="call-talk" accessibilityLabel={listening ? 'Done talking' : 'Talk'}>
          <Icon name={listening ? 'square' : 'mic'} size={30} color={colors.background} />
        </TouchableOpacity>
        <Text style={styles.controlLabel}>{listening ? 'Pause to send' : 'Talk'}</Text>
      </View>
      <View style={styles.control}>
        <TouchableOpacity style={styles.round} onPress={() => call.askHint()} testID="call-hint-button" accessibilityLabel="What do I say?"><Icon name="help-circle" size={24} color={colors.text} /></TouchableOpacity>
        <Text style={styles.controlLabel}>What do I say?</Text>
      </View>
    </View>
    <View style={styles.endRow}>
      <TouchableOpacity style={[styles.round, styles.end, styles.endBig]} onPress={() => call.hangUp()} testID="call-end" accessibilityLabel="End call"><Icon name="phone-off" size={28} color={colors.background} /></TouchableOpacity>
      <Text style={styles.controlLabel}>End call</Text>
    </View>
    </>
  );
}

/**
 * A practice phone call in the language being learned: the AI plays a person in an everyday
 * situation and the learner talks to it. Opened from a board call square (with the scenario of the
 * lesson before it) or from "Practice call" on the course screen (the learner picks one).
 */
export const CallScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const params = (useRoute<any>().params ?? {}) as { key?: string; scenarioId?: string };
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const code = useLanguage((s) => s.language);
  const langName = LANGUAGES.find((l) => l.code === code)?.name ?? code;
  const [scenario, setScenario] = useState<Scenario | null>(SCENARIOS.find((s) => s.id === params.scenarioId) ?? null);
  const call = useMemo(() => (scenario ? createCall(scenario) : null), [scenario]);
  const state = useCallState(call);
  const captions = useLanguage((s) => s.captions !== false);
  const [shown, setShown] = useState<number[]>([]);
  const [typed, setTyped] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const scroll = useRef<ScrollView>(null);

  useEffect(() => { call?.start(); return () => call?.dispose(); }, [call]);
  // The phone's Back button hangs up a live call (it used to be the only way out), and the screen stays on during it.
  useEffect(() => {
    if (!call || state?.phase === 'ended') return;
    keepScreenOn(true);
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { call.hangUp(); return true; });
    return () => { sub.remove(); keepScreenOn(false); };
  }, [call, state?.phase === 'ended']); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!call || state?.phase === 'ended') return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [call, state?.phase === 'ended']); // eslint-disable-line react-hooks/exhaustive-deps
  // A board call counts as done once the learner has said enough.
  useEffect(() => { if (state?.phase === 'ended' && state.passed && params.key) languageService.completeSpace(params.key); }, [state?.phase, state?.passed, params.key]);

  const header = (
    <View style={styles.top}>
      <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={20} color={colors.text} /></TouchableOpacity>
      <Text style={[styles.prompt, styles.sayText]}>Practice call in {langName}</Text>
      <TouchableOpacity onPress={() => languageService.setCaptions(!captions)} testID="call-captions" accessibilityLabel={captions ? 'Captions on' : 'Captions off'}>
        <Icon name={captions ? 'type' : 'eye-off'} size={18} color={captions ? colors.primary : colors.textMuted} />
      </TouchableOpacity>
    </View>
  );

  if (!call || !state) return <SafeAreaView style={styles.container}>{header}<Setup onStart={setScenario} /></SafeAreaView>;
  if (state.phase === 'ended') return <SafeAreaView style={styles.container}>{header}<Review state={state} onDone={() => navigation.goBack()} /></SafeAreaView>;

  const live = state.phase === 'speaking' || state.phase === 'listening';
  const listening = state.phase === 'listening';
  const send = () => { call.say(typed); setTyped(''); };
  return (
    <SafeAreaView style={styles.container} testID="language-call">
      <View style={styles.callTop}>
        <View style={[styles.avatar, styles.avatarBig, live && styles.avatarLive]}><Icon name={scenario!.icon} size={48} color={colors.primary} /></View>
        <Text style={styles.callTitle} numberOfLines={2}>{scenario!.title}</Text>
        <Text style={styles.meta} testID="call-timer">{formatCallTime(elapsed)}</Text>
        <Text style={styles.status} testID="call-status">{state.note ?? STATUS[state.phase]}</Text>
        {state.needsModel && <ForceLoadModel testID="call-force-load" />}
      </View>
      <ScrollView ref={scroll} style={styles.transcriptScroll} contentContainerStyle={styles.transcript} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {state.turns.map((t, i) => (
          <Bubble key={i} turn={t} index={i} hidden={t.who === 'them' && !captions && !shown.includes(i)} onReveal={() => setShown((s) => [...s, i])} />
        ))}
        {!!state.partial && <View style={[styles.bubble, styles.bubbleMine]}><Text style={styles.roman}>{state.partial}</Text></View>}
        {state.phase === 'thinking' && <ActivityIndicator color={colors.primary} />}
        {!!state.hint && <HintBox hint={state.hint} code={code} />}
      </ScrollView>
      {state.typing && (
        <View style={styles.top}>
          <TextInput value={typed} onChangeText={setTyped} onSubmitEditing={send} placeholder="Type what you would say" placeholderTextColor={colors.textMuted}
            autoCapitalize="none" style={[styles.typed, styles.sayText]} testID="call-typed" />
          <TouchableOpacity onPress={send} accessibilityLabel="Send" testID="call-send"><Icon name="send" size={22} color={colors.primary} /></TouchableOpacity>
        </View>
      )}
      <CallControls call={call} listening={listening} captions={captions} />
    </SafeAreaView>
  );
};

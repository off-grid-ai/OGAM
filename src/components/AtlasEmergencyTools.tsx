/**
 * Emergency-mode tools (work with no model and no internet): survival drills,
 * survival picture quiz, phrase practice, SOS / Morse signal, daylight left,
 * and preparedness checklists.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Image, Modal, NativeModules, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { DRILLS, type Drill } from '../survival/drills';
import { SURVIVAL_CHAPTERS } from '../survival/content';
import { SURVIVAL_IMAGES } from '../survival/images';
import { PHRASES_EN, PHRASE_LANGUAGES } from '../phrases/data';
import { speakIn, stop } from '../atlasVoice/tts';
import { morseTimeline, toMorse } from '../atlasTools/morse';
import { formatDuration, sunTimes } from '../atlasTools/sun';
import { expiringSoon, useChecklists } from '../atlasTools/checklists';
import { shuffle } from '../study/games/logic';
const BORDERWIDTH_0 = 0;
const BORDERWIDTH_1 = 1;
const OPACITY_0_5 = 0.5;
const OPACITY_1 = 1;
const COLOR_FFF = '#fff';
const BACKGROUNDCOLOR_16A34A33 = '#16A34A33';
const BACKGROUNDCOLOR_DC262633 = '#DC262633';
const BACKGROUNDCOLOR_FFF = '#fff';
const BORDERCOLOR_16A34A = '#16A34A';
const BACKGROUNDCOLOR_FFFFFF = '#FFFFFF';
const BACKGROUNDCOLOR_000000 = '#000000';
const COLOR_000 = '#000';
const COLOR_888 = '#888';
const BACKGROUNDCOLOR_CA8A0433 = '#CA8A0433';
const TEXTDECORATIONLINE_LINE_THROUGH = 'line-through';
const TEXTDECORATIONLINE_NONE = 'none';
const literalStyles = StyleSheet.create({
  s1: { flex: 1 },
  s2: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1 },
  s3: { padding: 8 },
  s4: { fontSize: 19, fontWeight: '700', marginLeft: 6 },
  s5: { padding: 16, paddingBottom: 80, width: '100%', maxWidth: 820, alignSelf: 'center' },
  s6: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12 },
  s7: { marginBottom: 10 },
  s8: { marginLeft: 12, flex: 1 },
  s9: { fontSize: 17, fontWeight: '700' },
  s10: { fontSize: 13 },
  s11: { padding: 13, borderRadius: 10, marginVertical: 5, minHeight: 48, justifyContent: 'center' },
  s12: { textAlign: 'center', fontWeight: '700' },
  s13: { marginBottom: 8 },
  s14: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 10 },
  s15: { fontSize: 16, marginLeft: 10 },
  s16: { fontSize: 22, fontWeight: '800' },
  s17: { marginVertical: 6 },
  s18: { fontSize: 18, lineHeight: 26, marginBottom: 10 },
  s19: { padding: 14, borderRadius: 10, borderWidth: 1 },
  s20: { fontSize: 16 },
  s21: { padding: 14, borderRadius: 10 },
  s22: { fontWeight: '800', fontSize: 17 },
  s23: { marginTop: 4, lineHeight: 22 },
  s24: { marginTop: 4, fontSize: 12 },
  s25: { backgroundColor: BACKGROUNDCOLOR_FFF, borderRadius: 10, padding: 8, marginVertical: 8, alignItems: 'center' },
  s26: { width: '100%', height: 240 },
  s27: { fontWeight: '600', marginBottom: 4 },
  s28: { padding: 12, borderRadius: 10, borderWidth: 1, marginVertical: 4 },
  s29: { marginTop: 4 },
  s30: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, marginRight: 6 },
  s31: { flexDirection: 'row', gap: 8 },
  s32: { padding: 8, borderRadius: 8 },
  s33: { fontSize: 20, fontWeight: '700', marginVertical: 6 },
  s34: { fontSize: 20, fontWeight: '700' },
  s35: { marginBottom: 6 },
  s36: { fontSize: 12, marginTop: 8 },
  s37: { height: 520, borderRadius: 16 },
  s38: { justifyContent: 'flex-end', alignItems: 'center', padding: 16 },
  s39: { borderRadius: 10, padding: 12, fontSize: 18, letterSpacing: 2 },
  s40: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  s41: { marginLeft: 8 },
  s42: { fontSize: 12 },
  s43: { fontSize: 18 },
  s44: { fontSize: 30, fontWeight: '800', marginVertical: 10 },
  s45: { lineHeight: 21 },
  s46: { fontSize: 12, marginTop: 10 },
  s47: { padding: 12, borderRadius: 10, backgroundColor: BACKGROUNDCOLOR_CA8A0433, marginBottom: 8 },
  s48: { fontWeight: '700' },
  s49: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  s50: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  s51: { marginLeft: 10, flex: 1 },
  s52: { padding: 6 },
  s53: { flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center' },
  s54: { borderRadius: 8, padding: 10 },
  s55: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
});


type Tool = 'menu' | 'drills' | 'pictures' | 'phrases' | 'signal' | 'daylight' | 'checklists';
const TOOLS: { id: Exclude<Tool, 'menu'>; title: string; desc: string; icon: string }[] = [
  { id: 'drills', title: 'Survival drills', desc: 'What would you do? Scenarios checked against the emergency cards', icon: 'target' },
  { id: 'signal', title: 'SOS signal', desc: 'Flash SOS or any message in Morse with the screen or flashlight', icon: 'zap' },
  { id: 'daylight', title: 'Daylight left', desc: 'Sunrise and sunset from GPS, with a turn-back time', icon: 'sunset' },
  { id: 'checklists', title: 'Kit checklists', desc: 'Go-bag, 72-hour, car and first-aid kits with expiry dates', icon: 'check-square' },
  { id: 'pictures', title: 'Survival picture quiz', desc: 'Name the figures from the Survival Manual', icon: 'image' },
  { id: 'phrases', title: 'Phrase practice', desc: 'Listen and recall emergency phrases in other languages', icon: 'globe' },
];

export function AtlasEmergencyTools({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const [tool, setTool] = useState<Tool>('menu');
  const close = () => { stop(); setTool('menu'); onClose(); };
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => (tool === 'menu' ? close() : setTool('menu'))}>
      <SafeAreaView style={[literalStyles.s1, { backgroundColor: colors.background }]}>
        <View style={[literalStyles.s2, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => (tool === 'menu' ? close() : setTool('menu'))} accessibilityLabel="Back" style={literalStyles.s3}>
            <Icon name="arrow-left" size={22} color={colors.text} />
          </TouchableOpacity>
          <Text style={[{ color: colors.text }, literalStyles.s4]}>{tool === 'menu' ? 'Emergency tools' : TOOLS.find((t) => t.id === tool)?.title}</Text>
        </View>
        <ScrollView contentContainerStyle={literalStyles.s5} keyboardShouldPersistTaps="handled">
          {tool === 'menu' && TOOLS.map((t) => (
            <TouchableOpacity key={t.id} onPress={() => setTool(t.id)} accessibilityRole="button" style={[literalStyles.s6, { backgroundColor: colors.surface }, literalStyles.s7]}>
              <Icon name={t.icon} size={22} color={colors.primary} />
              <View style={literalStyles.s8}>
                <Text style={[{ color: colors.text }, literalStyles.s9]}>{t.title}</Text>
                <Text style={[{ color: colors.textSecondary }, literalStyles.s10]}>{t.desc}</Text>
              </View>
            </TouchableOpacity>
          ))}
          {tool === 'drills' && <Drills />}
          {tool === 'pictures' && <PictureQuiz />}
          {tool === 'phrases' && <PhrasePractice />}
          {tool === 'signal' && <SignalTool />}
          {tool === 'daylight' && <Daylight />}
          {tool === 'checklists' && <Checklists />}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Btn({ label, onPress, primary = true, disabled }: { label: string; onPress: () => void; primary?: boolean; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={[literalStyles.s11, { backgroundColor: primary ? colors.primary : colors.surface, borderWidth: primary ? BORDERWIDTH_0 : BORDERWIDTH_1, borderColor: colors.border, opacity: disabled ? OPACITY_0_5 : OPACITY_1 }]}>
      <Text style={[{ color: primary ? COLOR_FFF : colors.text }, literalStyles.s12]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ----------------------------------------------------------------- survival drills
function Drills() {
  const { colors } = useTheme();
  const [drill, setDrill] = useState<Drill | null>(null);
  const [node, setNode] = useState('');
  const [feedback, setFeedback] = useState<{ good: boolean; why: string; card: string; next: string | null } | null>(null);
  const [score, setScore] = useState({ good: 0, total: 0 });
  if (!drill) {
    return (
      <View>
        <Text style={[{ color: colors.textSecondary }, literalStyles.s13]}>Practise the right first steps before you need them. Every answer names the emergency card it comes from.</Text>
        {DRILLS.map((d) => (
          <TouchableOpacity key={d.id} onPress={() => { setDrill(d); setNode(d.start); setFeedback(null); setScore({ good: 0, total: 0 }); }} style={[literalStyles.s14, { backgroundColor: colors.surface }, literalStyles.s13]}>
            <Icon name={d.icon} size={20} color={colors.primary} />
            <Text style={[{ color: colors.text }, literalStyles.s15]}>{d.title}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }
  const current = drill.nodes[node];
  if (!current) {
    return (
      <View>
        <Text style={[{ color: colors.text }, literalStyles.s16]}>{score.good === score.total ? 'Well done!' : 'Drill finished'}</Text>
        <Text style={[{ color: colors.textSecondary }, literalStyles.s17]}>{score.good} of {score.total} best choices. Read the matching emergency cards to lock it in.</Text>
        <Btn label="Try it again" onPress={() => { setNode(drill.start); setScore({ good: 0, total: 0 }); }} />
        <Btn label="Other drills" primary={false} onPress={() => setDrill(null)} />
      </View>
    );
  }
  return (
    <View>
      <Text style={[{ color: colors.text }, literalStyles.s18]}>{current.text}</Text>
      {!feedback ? current.choices.map((c, i) => (
        <TouchableOpacity key={i} onPress={() => { setFeedback({ good: c.good, why: c.why, card: c.card, next: c.next }); setScore((s) => ({ good: s.good + (c.good ? 1 : 0), total: s.total + 1 })); }}
          style={[literalStyles.s19, { borderColor: colors.border, backgroundColor: colors.surface }, literalStyles.s13]}>
          <Text style={[{ color: colors.text }, literalStyles.s20]}>{c.text}</Text>
        </TouchableOpacity>
      )) : (
        <View style={[literalStyles.s21, { backgroundColor: feedback.good ? BACKGROUNDCOLOR_16A34A33 : BACKGROUNDCOLOR_DC262633 }]}>
          <Text style={[{ color: colors.text }, literalStyles.s22]}>{feedback.good ? 'Good call' : 'Not the best choice'}</Text>
          <Text style={[{ color: colors.text }, literalStyles.s23]}>{feedback.why}</Text>
          <Text style={[{ color: colors.textMuted }, literalStyles.s24]}>From emergency card {feedback.card}</Text>
          <Btn label="Continue" onPress={() => { setNode(feedback.next ?? '__end'); setFeedback(null); }} />
        </View>
      )}
    </View>
  );
}

// ----------------------------------------------------------------- survival picture quiz
interface Figure { title: string; file: string; chapter: string }
function allFigures(): Figure[] {
  const out: Figure[] = [];
  const re = /!\[Figure [\d-]+\\?\.\s*([^\]]+)\]\((fig[\d-]+\.png)\)/g;
  for (const ch of SURVIVAL_CHAPTERS) {
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(ch.md))) {
      const title = m[1].replace(/\\/g, '').trim();
      if (SURVIVAL_IMAGES[m[2]] && title.length > 2 && !out.some((f) => f.title === title)) out.push({ title, file: m[2], chapter: ch.title });
    }
  }
  return out;
}
function PictureQuiz() {
  const { colors } = useTheme();
  const figures = useMemo(allFigures, []);
  const [round, setRound] = useState(() => shuffle(figures).slice(0, 10));
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const fig = round[i];
  const options = useMemo(() => (fig ? shuffle([fig.title, ...shuffle(figures.filter((f) => f.title !== fig.title)).slice(0, 3).map((f) => f.title)]) : []), [fig, figures]);
  if (figures.length < 4) return <Text style={{ color: colors.textSecondary }}>The Survival Manual pictures are not available in this build.</Text>;
  if (!fig) {
    return (
      <View>
        <Text style={[{ color: colors.text }, literalStyles.s16]}>{score} / {round.length}</Text>
        <Btn label="New round" onPress={() => { setRound(shuffle(figures).slice(0, 10)); setI(0); setScore(0); setPicked(null); }} />
      </View>
    );
  }
  return (
    <View>
      <Text style={{ color: colors.textSecondary }}>Picture {i + 1} of {round.length} · score {score}</Text>
      <View style={literalStyles.s25}>
        <Image source={SURVIVAL_IMAGES[fig.file]} style={literalStyles.s26} resizeMode="contain" accessibilityLabel="Survival Manual figure" />
      </View>
      <Text style={[{ color: colors.text }, literalStyles.s27]}>What does this figure show?</Text>
      {options.map((o) => {
        const state = picked === null ? null : o === fig.title ? 'right' : o === picked ? 'wrong' : null;
        return (
          <TouchableOpacity key={o} disabled={picked !== null} onPress={() => { setPicked(o); if (o === fig.title) setScore((s) => s + 1); }}
            style={[literalStyles.s28, { borderColor: state === 'right' ? BORDERCOLOR_16A34A : state === 'wrong' ? '#DC2626' : colors.border, backgroundColor: state === 'right' ? BACKGROUNDCOLOR_16A34A33 : state === 'wrong' ? '#DC262633' : colors.surface }]}>
            <Text style={{ color: colors.text }}>{o}</Text>
          </TouchableOpacity>
        );
      })}
      {picked !== null && (
        <View>
          <Text style={[{ color: colors.textSecondary }, literalStyles.s29]}>From the chapter “{fig.chapter}”.</Text>
          <Btn label="Next picture" onPress={() => { setPicked(null); setI((x) => x + 1); }} />
        </View>
      )}
    </View>
  );
}

// ----------------------------------------------------------------- phrase practice
function PhrasePractice() {
  const { colors } = useTheme();
  const [lang, setLang] = useState(PHRASE_LANGUAGES[0]);
  const [mode, setMode] = useState<'listen' | 'recall'>('listen');
  const [order, setOrder] = useState(() => shuffle(PHRASES_EN.map((_, k) => k)));
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [shown, setShown] = useState(false);
  const [score, setScore] = useState(0);
  const idx = order[i % order.length];
  const phrase = lang.phrases[idx];
  const options = useMemo(() => shuffle([idx, ...shuffle(PHRASES_EN.map((_, k) => k).filter((k) => k !== idx)).slice(0, 3)]), [idx]);
  useEffect(() => () => stop(), []);
  const say = () => phrase && speakIn(phrase[0], lang.code, 'phrase-practice');
  useEffect(() => { if (mode === 'listen') setTimeout(say, 300); }, [i, mode, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const next = () => { setPicked(null); setShown(false); setI((x) => x + 1); };
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={literalStyles.s13}>
        {PHRASE_LANGUAGES.map((l) => (
          <TouchableOpacity key={l.code} onPress={() => { setLang(l); setOrder(shuffle(PHRASES_EN.map((_, k) => k))); setI(0); setScore(0); setPicked(null); setShown(false); }}
            style={[literalStyles.s30, { backgroundColor: l.code === lang.code ? colors.primary : colors.surface }]}>
            <Text style={{ color: l.code === lang.code ? COLOR_FFF : colors.text }}>{l.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={literalStyles.s31}>
        {(['listen', 'recall'] as const).map((m) => (
          <TouchableOpacity key={m} onPress={() => { setMode(m); setPicked(null); setShown(false); }} style={[literalStyles.s32, { backgroundColor: mode === m ? colors.primary : colors.surface }]}>
            <Text style={{ color: mode === m ? COLOR_FFF : colors.text }}>{m === 'listen' ? 'Listen: pick the meaning' : 'Recall: say it yourself'}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={[{ color: colors.textSecondary }, literalStyles.s17]}>Score {score} · phrase {i + 1}</Text>
      {mode === 'listen' ? (
        <View>
          <Btn label="🔊 Play again" primary={false} onPress={say} />
          {picked !== null && <Text style={[{ color: colors.text }, literalStyles.s33]}>{phrase?.[0]}{phrase?.[1] ? `\n${phrase[1]}` : ''}</Text>}
          {options.map((k) => {
            const state = picked === null ? null : k === idx ? 'right' : k === picked ? 'wrong' : null;
            return (
              <TouchableOpacity key={k} disabled={picked !== null} onPress={() => { setPicked(k); if (k === idx) setScore((s) => s + 1); }}
                style={[literalStyles.s28, { borderColor: state === 'right' ? BORDERCOLOR_16A34A : state === 'wrong' ? '#DC2626' : colors.border, backgroundColor: colors.surface }]}>
                <Text style={{ color: colors.text }}>{PHRASES_EN[k]}</Text>
              </TouchableOpacity>
            );
          })}
          {picked !== null && <Btn label="Next phrase" onPress={next} />}
        </View>
      ) : (
        <View>
          <Text style={[{ color: colors.text }, literalStyles.s34]}>{PHRASES_EN[idx]}</Text>
          <Text style={[{ color: colors.textSecondary }, literalStyles.s35]}>Say it in {lang.name} out loud, then check.</Text>
          {!shown ? <Btn label="Show and play" onPress={() => { setShown(true); say(); }} /> : (
            <View>
              <Text style={[{ color: colors.primary }, literalStyles.s16]}>{phrase?.[0]}</Text>
              {!!phrase?.[1] && <Text style={{ color: colors.textSecondary }}>{phrase[1]}</Text>}
              <View style={literalStyles.s31}>
                <View style={literalStyles.s1}><Btn label="Missed it" primary={false} onPress={next} /></View>
                <View style={literalStyles.s1}><Btn label="Got it" onPress={() => { setScore((s) => s + 1); next(); }} /></View>
              </View>
            </View>
          )}
        </View>
      )}
      <Text style={[{ color: colors.textMuted }, literalStyles.s36]}>Phrases were written by AI and not yet checked by native speakers.</Text>
    </View>
  );
}

// ----------------------------------------------------------------- SOS / Morse signal
const UNIT_MS = 220;
function SignalTool() {
  const { colors } = useTheme();
  const [text, setText] = useState('SOS');
  const [running, setRunning] = useState(false);
  const [lit, setLit] = useState(false);
  const [torch, setTorch] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const device: any = NativeModules.AtlasDevice;
  const setLight = (on: boolean) => {
    setLit(on);
    if (torch && Platform.OS === 'android') device?.setTorch?.(on)?.catch?.(() => undefined);
  };
  const halt = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setRunning(false); setLight(false);
    device?.setKeepScreenOn?.(false)?.catch?.(() => undefined);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); device?.setTorch?.(false)?.catch?.(() => undefined); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => {
    const steps = morseTimeline(text || 'SOS', true);
    if (!steps.length) return;
    setRunning(true);
    device?.setKeepScreenOn?.(true)?.catch?.(() => undefined);
    let k = 0;
    const tick = () => {
      const s = steps[k % steps.length];
      setLight(s.on);
      k++;
      timer.current = setTimeout(tick, s.units * UNIT_MS);
    };
    tick();
  };
  if (running) {
    return (
      <TouchableOpacity activeOpacity={1} onPress={halt} accessibilityLabel="Stop signalling"
        style={[literalStyles.s37, { backgroundColor: lit ? BACKGROUNDCOLOR_FFFFFF : BACKGROUNDCOLOR_000000 }, literalStyles.s38]}>
        <Text style={{ color: lit ? COLOR_000 : COLOR_888 }}>{toMorse(text)} · tap to stop</Text>
      </TouchableOpacity>
    );
  }
  return (
    <View>
      <Text style={[{ color: colors.textSecondary }, literalStyles.s13]}>Flash a message in Morse code. At night a phone screen or flashlight can be seen from far away. Turn the screen brightness all the way up.</Text>
      <TextInput value={text} onChangeText={(v) => setText(v.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 30))} placeholder="SOS" placeholderTextColor={colors.textMuted}
        style={[{ color: colors.text, backgroundColor: colors.surface }, literalStyles.s39]} />
      <Text style={[{ color: colors.textMuted }, literalStyles.s17]}>{toMorse(text || 'SOS')}</Text>
      <TouchableOpacity onPress={() => setTorch((t) => !t)} accessibilityRole="switch" accessibilityState={{ checked: torch }} style={literalStyles.s40}>
        <Icon name={torch ? 'check-square' : 'square'} size={20} color={colors.primary} />
        <Text style={[{ color: colors.text }, literalStyles.s41]}>Also flash the flashlight</Text>
      </TouchableOpacity>
      <Btn label="Start signalling" onPress={start} />
      <Text style={[{ color: colors.textMuted }, literalStyles.s42]}>SOS = ··· ––– ··· repeated. Also: 3 whistle blasts or 3 fires mean help (card S01).</Text>
    </View>
  );
}

// ----------------------------------------------------------------- daylight left
function Daylight() {
  const { colors } = useTheme();
  const fix = (() => { try { return require('../atlasMaps/maps').useMaps.getState().lastFix; } catch { return null; } })();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  if (!fix) return <Text style={{ color: colors.textSecondary }}>No GPS position yet. Open Atlas → Maps once and allow location (works without internet), then come back.</Text>;
  const t = sunTimes(new Date(now), fix.lat, fix.lon);
  const fmt = (d: Date | null) => (d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—');
  const left = t.sunset ? t.sunset.getTime() - now : 0;
  return (
    <View>
      {t.polar ? <Text style={[{ color: colors.text }, literalStyles.s43]}>{t.polar === 'day' ? 'The sun does not set today here.' : 'The sun does not rise today here.'}</Text> : (
        <View>
          <Text style={[{ color: colors.text }, literalStyles.s43]}>Sunrise {fmt(t.sunrise)} · Sunset {fmt(t.sunset)}</Text>
          <Text style={[{ color: left > 0 ? colors.text : colors.error }, literalStyles.s44]}>
            {left > 0 ? `${formatDuration(left)} of daylight left` : 'The sun has set'}
          </Text>
          {left > 0 && <Text style={[{ color: colors.textSecondary }, literalStyles.s45]}>Turn back by {new Date(now + left / 2).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} if you need to return the way you came before dark (half the remaining daylight). Real dusk is darker under trees and in valleys.</Text>}
        </View>
      )}
      <Text style={[{ color: colors.textMuted }, literalStyles.s46]}>From your last GPS fix ({fix.lat.toFixed(3)}, {fix.lon.toFixed(3)}), computed on the phone.</Text>
    </View>
  );
}

// ----------------------------------------------------------------- checklists
function Checklists() {
  const { colors } = useTheme();
  const lists = useChecklists((s) => s.lists);
  const { toggle, setExpiry, add, remove, reset } = useChecklists.getState();
  const [open, setOpen] = useState(lists[0]?.id);
  const [newItem, setNewItem] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [expiryText, setExpiryText] = useState('');
  const soon = expiringSoon(lists);
  const list = lists.find((l) => l.id === open) ?? lists[0];
  return (
    <View>
      {soon.length > 0 && (
        <View style={literalStyles.s47}>
          <Text style={[{ color: colors.text }, literalStyles.s48]}>Expiring soon</Text>
          {soon.map(({ list: l, item }) => <Text key={item.id} style={{ color: colors.text }}>• {item.text} ({l}): {item.expires}</Text>)}
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {lists.map((l) => {
          const done = l.items.filter((i) => i.done).length;
          return (
            <TouchableOpacity key={l.id} onPress={() => setOpen(l.id)} style={[literalStyles.s30, { backgroundColor: l.id === list.id ? colors.primary : colors.surface }]}>
              <Text style={{ color: l.id === list.id ? COLOR_FFF : colors.text }}>{l.title} {done}/{l.items.length}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      {list.items.map((it) => (
        <View key={it.id} style={[literalStyles.s49, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => toggle(list.id, it.id)} accessibilityRole="checkbox" accessibilityState={{ checked: it.done }} accessibilityLabel={it.text} style={literalStyles.s50}>
            <Icon name={it.done ? 'check-square' : 'square'} size={20} color={colors.primary} />
            <View style={literalStyles.s51}>
              <Text style={{ color: colors.text, textDecorationLine: it.done ? TEXTDECORATIONLINE_LINE_THROUGH : TEXTDECORATIONLINE_NONE }}>{it.text}</Text>
              {!!it.expires && <Text style={[{ color: colors.textMuted }, literalStyles.s42]}>Expires {it.expires}</Text>}
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setEditing(it.id); setExpiryText(it.expires ?? ''); }} accessibilityLabel={`Set expiry for ${it.text}`} style={literalStyles.s52}><Icon name="calendar" size={16} color={colors.textMuted} /></TouchableOpacity>
          <TouchableOpacity onPress={() => remove(list.id, it.id)} accessibilityLabel={`Remove ${it.text}`} style={literalStyles.s52}><Icon name="x" size={16} color={colors.textMuted} /></TouchableOpacity>
        </View>
      ))}
      {editing && (
        <View style={literalStyles.s53}>
          <TextInput value={expiryText} onChangeText={setExpiryText} placeholder="Expiry date YYYY-MM-DD" placeholderTextColor={colors.textMuted} style={[literalStyles.s1, { color: colors.text, backgroundColor: colors.surface }, literalStyles.s54]} />
          <TouchableOpacity onPress={() => { if (!expiryText || /^\d{4}-\d{2}-\d{2}$/.test(expiryText)) { setExpiry(list.id, editing, expiryText); setEditing(null); } }}><Text style={[{ color: colors.primary }, literalStyles.s48]}>Save</Text></TouchableOpacity>
        </View>
      )}
      <View style={literalStyles.s55}>
        <TextInput value={newItem} onChangeText={setNewItem} placeholder="Add an item" placeholderTextColor={colors.textMuted} style={[literalStyles.s1, { color: colors.text, backgroundColor: colors.surface }, literalStyles.s54]} />
        <TouchableOpacity onPress={() => { if (newItem.trim()) { add(list.id, newItem.trim()); setNewItem(''); } }}><Text style={[{ color: colors.primary }, literalStyles.s48]}>Add</Text></TouchableOpacity>
      </View>
      <Btn label="Untick all (repack)" primary={false} onPress={() => reset(list.id)} />
    </View>
  );
}

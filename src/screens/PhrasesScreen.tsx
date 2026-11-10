import React, { useEffect, useState } from 'react';
import { StyleSheet, ActivityIndicator, Alert, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme';
import { useEmergencyColors, useOffGrid } from '../atlasTools/offGrid';
import { PHRASES_EN, PHRASE_LANGUAGES, Phrase } from '../phrases/data';
import { speakIn, stop, onMissingLanguage } from '../atlasVoice/tts';
import { ensureTextModel } from '../atlasTools/models';
import { completeSmallTask } from '../services/engines';
const BACKGROUNDCOLOR_111 = '#111';
const COLOR_FFF = '#fff';
const COLOR_CCC = '#ccc';
const COLOR_888 = '#888';
const BACKGROUNDCOLOR_2563EB = '#2563EB';
const BACKGROUNDCOLOR_333 = '#333';
const literalStyles = StyleSheet.create({
  s1: { flex: 1, backgroundColor: BACKGROUNDCOLOR_111 },
  s2: { flex: 1, justifyContent: 'center', padding: 24 },
  s3: { color: COLOR_FFF },
  s4: { fontWeight: '700', textAlign: 'center' },
  s5: { color: COLOR_CCC },
  s6: { textAlign: 'center', marginTop: 16 },
  s7: { color: COLOR_888, fontSize: 16, textAlign: 'center', marginTop: 28 },
  s8: { flexDirection: 'row', justifyContent: 'center', paddingBottom: 30, gap: 16 },
  s9: { backgroundColor: BACKGROUNDCOLOR_2563EB, borderRadius: 30, paddingHorizontal: 26, paddingVertical: 14, flexDirection: 'row', alignItems: 'center' },
  s10: { color: COLOR_FFF, fontSize: 18, marginLeft: 8 },
  s11: { backgroundColor: BACKGROUNDCOLOR_333, borderRadius: 30, paddingHorizontal: 26, paddingVertical: 14 },
  s12: { color: COLOR_FFF, fontSize: 18 },
  s13: { flex: 1 },
  s14: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  s15: { padding: 6 },
  s16: { color: COLOR_FFF, fontSize: 21, fontWeight: '800', marginLeft: 8 },
  s17: { flexGrow: 0 },
  s18: { padding: 10 },
  s19: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, marginRight: 8 },
  s20: { padding: 12, paddingBottom: 120, width: '100%', maxWidth: 920, alignSelf: 'center' },
  s21: { fontSize: 12, marginBottom: 10 },
  s22: { borderRadius: 10, padding: 12, marginBottom: 12 },
  s23: { fontWeight: '600', marginBottom: 6 },
  s24: { flexDirection: 'row' },
  s25: { borderRadius: 8, padding: 10 },
  s26: { marginLeft: 8, backgroundColor: BACKGROUNDCOLOR_2563EB, borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center' },
  s27: { flexDirection: 'row', alignItems: 'center' },
  s28: { borderRadius: 10, marginBottom: 8 },
  s29: { flex: 1, padding: 14 },
  s30: { fontSize: 12 },
  s31: { fontSize: 20, fontWeight: '600', marginTop: 2 },
  s32: { fontSize: 14, marginTop: 2 },
  s33: { padding: 16 },
});


const LAST_LANG = 'atlas-phrases-lang';

/** Travel phrase cards: show big to the other person, or play aloud in their language. Offline. */
export const PhrasesScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors: baseColors } = useTheme();
  const colors = useEmergencyColors(baseColors);
  const night = useOffGrid((st) => st.nightRed);
  const bar = (c: string) => (night ? '#2A0000' : c);
  const { width } = useWindowDimensions();
  const [code, setCode] = useState(PHRASE_LANGUAGES[0].code);
  const [shown, setShown] = useState<{ text: string; roman?: string; en: string } | null>(null);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const lang = PHRASE_LANGUAGES.find((l) => l.code === code)!;
  const langRef = React.useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    AsyncStorage.getItem(LAST_LANG).then((v) => { if (v && PHRASE_LANGUAGES.some((l) => l.code === v)) setCode(v); }).catch(() => undefined);
    onMissingLanguage(() => Alert.alert('Voice not installed', `Your phone has no ${langRef.current.name} voice yet. Settings > Text-to-speech > install voice data for ${langRef.current.name} (download it while you have internet).`));
    return () => { onMissingLanguage(null); stop(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickLang = (c: string) => { setCode(c); AsyncStorage.setItem(LAST_LANG, c).catch(() => undefined); };

  const translate = async () => {
    if (!custom.trim()) return;
    setBusy(true);
    try {
      await ensureTextModel(null);
      const out: string = await completeSmallTask([
        { id: 's', role: 'system', content: `You translate short phrases into ${lang.name}. Reply with ONLY the translation${/^(ja|zh|ar|hi|ru)/.test(code) ? ', then on a new line the pronunciation in Latin letters' : ''}. No explanations.`, timestamp: 0 },
        { id: 'u', role: 'user', content: custom.trim(), timestamp: 0 },
      ], 'The model is busy with a chat. Try again in a moment.');
      const lines = out.replace(/<think>[\s\S]*?<\/think>/g, '').trim().split('\n').map((l) => l.trim()).filter(Boolean);
      setShown({ text: lines[0] || '', roman: /^(ja|zh|ar|hi|ru)/.test(code) ? lines[1] : undefined, en: `${custom.trim()} (translated by the AI - may contain mistakes)` });
    } catch (e: any) {
      Alert.alert('Could not translate', String(e?.message || e));
    } finally { setBusy(false); }
  };

  if (shown) {
    const big = Math.min(64, Math.max(30, width / 12));
    return (
      <SafeAreaView style={literalStyles.s1}>
        <TouchableOpacity style={literalStyles.s2} activeOpacity={1} onPress={() => { stop(); setShown(null); }}>
          <Text style={[literalStyles.s3, { fontSize: big }, literalStyles.s4]}>{shown.text}</Text>
          {!!shown.roman && <Text style={[literalStyles.s5, { fontSize: big * 0.45 }, literalStyles.s6]}>{shown.roman}</Text>}
          <Text style={literalStyles.s7}>{shown.en}</Text>
        </TouchableOpacity>
        <View style={literalStyles.s8}>
          <TouchableOpacity onPress={() => speakIn(shown.text, code)} style={literalStyles.s9}>
            <Icon name="volume-2" size={22} color="#fff" /><Text style={literalStyles.s10}>Play</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { stop(); setShown(null); }} style={literalStyles.s11}>
            <Text style={literalStyles.s12}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[literalStyles.s13, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[literalStyles.s14, { backgroundColor: bar('#2563EB') }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={literalStyles.s15}><Icon name="arrow-left" size={22} color="#fff" /></TouchableOpacity>
        <Text style={literalStyles.s16}>Phrases</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={literalStyles.s17} contentContainerStyle={literalStyles.s18}>
        {PHRASE_LANGUAGES.map((l) => (
          <TouchableOpacity key={l.code} onPress={() => pickLang(l.code)} style={[literalStyles.s19, { backgroundColor: l.code === code ? BACKGROUNDCOLOR_2563EB : colors.surface }]}>
            <Text style={{ color: l.code === code ? COLOR_FFF : colors.text }}>{l.name} · {l.native}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <ScrollView contentContainerStyle={literalStyles.s20} keyboardShouldPersistTaps="handled">
        <Text style={[{ color: colors.textMuted }, literalStyles.s21]}>
          Tap a phrase to show it big to the other person; the speaker plays it in {lang.name} with your phone's voice. Translations were written by an AI - the meaning should be clear, but check important ones with a local when you can.
        </Text>
        <View style={[{ backgroundColor: colors.surface }, literalStyles.s22]}>
          <Text style={[{ color: colors.text }, literalStyles.s23]}>Translate anything (uses the loaded AI model, offline)</Text>
          <View style={literalStyles.s24}>
            <TextInput value={custom} onChangeText={setCustom} onSubmitEditing={translate} placeholder="e.g. My friend is not breathing" placeholderTextColor={colors.textMuted}
              style={[literalStyles.s13, { backgroundColor: colors.background, color: colors.text }, literalStyles.s25]} />
            <TouchableOpacity onPress={translate} disabled={busy} style={literalStyles.s26}>
              {busy ? <ActivityIndicator color="#fff" /> : <Icon name="arrow-right" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
        </View>
        {lang.phrases.map((p: Phrase, i: number) => (
          <View key={i} style={[literalStyles.s27, { backgroundColor: colors.surface }, literalStyles.s28]}>
            <TouchableOpacity style={literalStyles.s29} onPress={() => setShown({ text: p[0], roman: p[1], en: PHRASES_EN[i] })}>
              <Text style={[{ color: colors.textMuted }, literalStyles.s30]}>{PHRASES_EN[i]}</Text>
              <Text style={[{ color: colors.text }, literalStyles.s31]}>{p[0]}</Text>
              {!!p[1] && <Text style={[{ color: colors.textSecondary }, literalStyles.s32]}>{p[1]}</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => speakIn(p[0], code)} style={literalStyles.s33} accessibilityLabel="Play">
              <Icon name="volume-2" size={22} color="#2563EB" />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
};

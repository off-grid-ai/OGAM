import React, { useMemo, useState } from 'react';
import { StyleSheet, ScrollView, Text, TextInput, TouchableOpacity, View, useWindowDimensions, BackHandler } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { useEmergencyColors, useOffGrid } from '../atlasTools/offGrid';
import { ATLAS_CARDS } from '../learning/atlasCards';
import { speak, stop } from '../atlasVoice/tts';
import { useAtlasVoiceStore } from '../atlasVoice/store';
import { AtlasGames } from '../components/AtlasGames';
import { AtlasEmergencyTools } from '../components/AtlasEmergencyTools';
const COLOR_FFF = '#fff';
const BACKGROUNDCOLOR_1E0202 = '#1E0202';
const BORDERWIDTH_1 = 1;
const BORDERWIDTH_0 = 0;
const BORDERCOLOR_5A0E0E = '#5A0E0E';
const COLOR_RGBA_255_255_255_0_85 = 'rgba(255,255,255,0.85)';
const BORDERCOLOR_3F6212 = '#3F6212';
const BORDERCOLOR_0F766E = '#0F766E';
const literalStyles = StyleSheet.create({
  s1: { fontWeight: '700' },
  s2: { height: 8 },
  s3: { fontWeight: '700', marginTop: 14, marginBottom: 6 },
  s4: { flexDirection: 'row', marginBottom: 6 },
  s5: { fontWeight: '700', width: 28 },
  s6: { flex: 1 },
  s7: { flexDirection: 'row', marginBottom: 4 },
  s8: { width: 20 },
  s9: { marginBottom: 4 },
  s10: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  s11: { padding: 6 },
  s12: { color: COLOR_FFF, fontSize: 20, fontWeight: '700', flex: 1, marginLeft: 8 },
  s13: { padding: 8 },
  s14: { color: COLOR_FFF, fontSize: 16 },
  s15: { color: COLOR_FFF, fontSize: 20 },
  s16: { padding: 18, paddingBottom: 120, width: '100%', maxWidth: 900, alignSelf: 'center' },
  s17: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderWidth: 2 },
  s18: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 12 },
  s19: { fontSize: 16, fontWeight: '600', marginLeft: 8 },
  s20: { fontSize: 13, marginTop: 24 },
  s21: { fontSize: 13, marginTop: 4 },
  s22: { color: COLOR_FFF, fontSize: 22, fontWeight: '800', marginLeft: 8, flex: 1 },
  s23: { padding: 14, paddingBottom: 120, width: '100%', maxWidth: 1200, alignSelf: 'center' },
  s24: { padding: 15, borderRadius: 12 },
  s25: { marginBottom: 12, flexDirection: 'row', alignItems: 'center' },
  s26: { marginLeft: 12, flex: 1 },
  s27: { fontSize: 18, fontWeight: '700' },
  s28: { fontSize: 14, marginBottom: 10 },
  s29: { borderRadius: 10, padding: 12, fontSize: 16, marginBottom: 12 },
  s30: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  s31: { borderColor: BORDERCOLOR_5A0E0E, borderRadius: 14, padding: 18, minHeight: 92, flexDirection: 'row', alignItems: 'center' },
  s32: { marginLeft: 14, flex: 1 },
  s33: { color: COLOR_FFF, fontSize: 19, fontWeight: '700' },
  s34: { color: COLOR_RGBA_255_255_255_0_85, fontSize: 13, marginTop: 2 },
  s35: { marginTop: 14, padding: 16, borderRadius: 12, borderWidth: 2, borderColor: BORDERCOLOR_3F6212, flexDirection: 'row', alignItems: 'center' },
  s36: { fontSize: 17, fontWeight: '600', marginLeft: 12, flex: 1 },
  s37: { flexDirection: 'row', gap: 10, marginTop: 10 },
  s38: { flex: 1, padding: 14, borderRadius: 12, borderWidth: 2 },
  s39: { flexDirection: 'row', alignItems: 'center' },
  s40: { fontSize: 16, fontWeight: '600', marginLeft: 10, flex: 1 },
  s41: { fontSize: 15, marginTop: 12 },
});


/**
 * Atlas emergency screen: the built-in cards, readable instantly with no model loaded.
 * Big buttons, large text, read-aloud. Works fully offline.
 */
type Card = { file: string; id: string; title: string; zone: string; keywords: string; source: string; status: string; body: string };

const ZONE_COLOR: Record<string, string> = {
  Emergency: '#DC2626', 'Water and food': '#2563EB', Illness: '#EA580C', Mind: '#7C3AED', 'Power and tools': '#4B5563', Survival: '#3F6212',
};
const ZONE_ICON: Record<string, string> = {
  Emergency: 'alert-octagon', 'Water and food': 'droplet', Illness: 'thermometer', Mind: 'heart', 'Power and tools': 'battery-charging', Survival: 'compass',
};

function parse(file: string, raw: string): Card {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta: Record<string, string> = {};
  (m ? m[1] : '').split('\n').forEach((l) => {
    const i = l.indexOf(':');
    if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim();
  });
  return {
    file, id: meta.id || file, title: meta.title || file, zone: meta.zone || 'Emergency',
    keywords: meta.keywords || '', source: meta.source || '', status: meta.status || '', body: (m ? m[2] : raw).trim(),
  };
}

const plain = (s: string) => s.replace(/\*\*/g, '');

function Rich({ text, color, size }: { text: string; color: string; size: number }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <Text style={{ color, fontSize: size, lineHeight: size * 1.4 }}>
      {parts.map((p, i) => (p.startsWith('**') ? <Text key={i} style={literalStyles.s1}>{p.slice(2, -2)}</Text> : p))}
    </Text>
  );
}

function CardBody({ card, colors, size }: { card: Card; colors: any; size: number }) {
  return (
    <View>
      {card.body.split('\n').map((line, i) => {
        const l = line.trimEnd();
        if (!l.trim()) return <View key={i} style={literalStyles.s2} />;
        if (l.startsWith('## ')) return <Text key={i} style={[{ color: colors.text, fontSize: size + 3 }, literalStyles.s3]}>{plain(l.slice(3))}</Text>;
        const num = l.match(/^(\d+)\.\s+(.*)$/);
        if (num) return (
          <View key={i} style={literalStyles.s4}>
            <Text style={[{ color: ZONE_COLOR[card.zone] || colors.primary, fontSize: size }, literalStyles.s5]}>{num[1]}.</Text>
            <View style={literalStyles.s6}><Rich text={num[2]} color={colors.text} size={size} /></View>
          </View>
        );
        if (l.startsWith('- ')) return (
          <View key={i} style={literalStyles.s7}>
            <Text style={[{ color: colors.textSecondary, fontSize: size }, literalStyles.s8]}>•</Text>
            <View style={literalStyles.s6}><Rich text={l.slice(2)} color={colors.text} size={size} /></View>
          </View>
        );
        return <View key={i} style={literalStyles.s9}><Rich text={l} color={colors.text} size={size} /></View>;
      })}
    </View>
  );
}

export const EmergencyScreen: React.FC = () => {
  React.useEffect(() => () => stop(), []); // stop reading aloud when leaving the screen
  const navigation = useNavigation<any>();
  const { colors: baseColors } = useTheme();
  const colors = useEmergencyColors(baseColors);
  const night = useOffGrid((st) => st.nightRed);
  const setNight = useOffGrid((st) => st.setNightRed);
  const bar = (c: string) => (night ? '#2A0000' : c);
  const { width } = useWindowDimensions();
  const cards = useMemo(() => Object.entries(ATLAS_CARDS).map(([f, r]) => parse(f, r)), []);
  const [open, setOpen] = useState<Card | null>(null);
  const [gamesOpen, setGamesOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [q, setQ] = useState('');
  const [size, setSize] = useState(width >= 720 ? 20 : 17);
  const speaking = useAtlasVoiceStore((s) => s.speakingKey !== null && s.speakingMessageId === 'emergency-card');
  const cols = width >= 1000 ? 3 : width >= 600 ? 2 : 1;

  useFocusEffect(React.useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (open) { stop(); setOpen(null); return true; }
      return false;
    });
    return () => sub.remove();
  }, [open]));

  const shown = cards.filter((c) => {
    const s = q.trim().toLowerCase();
    return !s || `${c.title} ${c.keywords} ${c.zone}`.toLowerCase().includes(s);
  });

  if (open) {
    const zc = ZONE_COLOR[open.zone] || colors.primary;
    return (
      <SafeAreaView style={[literalStyles.s6, { backgroundColor: colors.background }]} edges={['top']}>
        <View style={[literalStyles.s10, { backgroundColor: bar(zc) }]}>
          <TouchableOpacity onPress={() => { stop(); setOpen(null); }} style={literalStyles.s11}><Icon name="arrow-left" size={24} color="#fff" /></TouchableOpacity>
          <Text style={literalStyles.s12} numberOfLines={2}>{open.title}</Text>
          <TouchableOpacity onPress={() => setSize((s) => Math.max(14, s - 2))} style={literalStyles.s13}><Text style={literalStyles.s14}>A-</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setSize((s) => Math.min(30, s + 2))} style={literalStyles.s13}><Text style={literalStyles.s15}>A+</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={literalStyles.s16}>
          <TouchableOpacity
            onPress={() => (speaking ? stop() : speak(open.body.replace(/\*\*/g, '').replace(/^## /gm, ''), 'emergency-card'))}
            style={[literalStyles.s17, { borderColor: zc }, literalStyles.s18]}
          >
            <Icon name={speaking ? 'volume-x' : 'volume-2'} size={20} color={zc} />
            <Text style={[{ color: zc }, literalStyles.s19]}>{speaking ? 'Stop reading' : 'Read aloud'}</Text>
          </TouchableOpacity>
          <CardBody card={open} colors={colors} size={size} />
          <Text style={[{ color: colors.textMuted }, literalStyles.s20]}>Source: {open.source}</Text>
          <Text style={[{ color: colors.textMuted }, literalStyles.s21]}>{open.status}</Text>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[literalStyles.s6, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[literalStyles.s10, { backgroundColor: bar('#DC2626') }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={literalStyles.s11}><Icon name="arrow-left" size={24} color="#fff" /></TouchableOpacity>
        <Text style={literalStyles.s22}>Emergency</Text>
        <TouchableOpacity onPress={() => setNight(!night)} style={literalStyles.s13} accessibilityLabel="Red night mode"><Icon name="moon" size={20} color="#fff" /></TouchableOpacity>
      </View>
      <AtlasGames visible={gamesOpen} onClose={() => setGamesOpen(false)} />
      <AtlasEmergencyTools visible={toolsOpen} onClose={() => setToolsOpen(false)} />
      <ScrollView contentContainerStyle={literalStyles.s23} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => setToolsOpen(true)} accessibilityRole="button" style={[literalStyles.s24, { backgroundColor: colors.surface }, literalStyles.s25]}>
          <Icon name="tool" size={23} color={colors.primary} />
          <View style={literalStyles.s26}><Text style={[{ color: colors.text }, literalStyles.s27]}>Emergency tools</Text><Text style={{ color: colors.textSecondary }}>SOS signal · daylight left · kit checklists · survival drills</Text></View>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setGamesOpen(true)} style={[literalStyles.s24, { backgroundColor: colors.surface }, literalStyles.s25]}>
          <Icon name="grid" size={23} color={colors.primary} />
          <View style={literalStyles.s26}><Text style={[{ color: colors.text }, literalStyles.s27]}>Offline Arcade</Text><Text style={{ color: colors.textSecondary }}>Standalone games · no model or internet needed</Text></View>
        </TouchableOpacity>
        <Text style={[{ color: colors.textSecondary }, literalStyles.s28]}>
          If someone may die (heavy bleeding, not breathing, unconscious): get help if any exists, then open the card. These work with no AI and no internet.
        </Text>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search: bleeding, snake, water, fever..."
          placeholderTextColor={colors.textMuted}
          style={[{ backgroundColor: colors.surface, color: colors.text }, literalStyles.s29]}
        />
        <View style={literalStyles.s30}>
          {shown.map((c) => {
            const zc = ZONE_COLOR[c.zone] || colors.primary;
            return (
              <View key={c.file} style={[{ width: `${100 / cols}%` }, literalStyles.s11]}>
                <TouchableOpacity
                  onPress={() => setOpen(c)}
                  style={[{ backgroundColor: night ? BACKGROUNDCOLOR_1E0202 : zc, borderWidth: night ? BORDERWIDTH_1 : BORDERWIDTH_0 }, literalStyles.s31]}
                >
                  <Icon name={ZONE_ICON[c.zone] || 'alert-circle'} size={30} color="#fff" />
                  <View style={literalStyles.s32}>
                    <Text style={literalStyles.s33}>{c.title}</Text>
                    <Text style={literalStyles.s34}>{c.zone}</Text>
                  </View>
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('SurvivalManual')} style={literalStyles.s35}>
          <Icon name="book-open" size={22} color="#3F6212" />
          <Text style={[{ color: colors.text }, literalStyles.s36]}>Full Survival Manual (water, fire, shelter, food, plants, first aid...)</Text>
          <Icon name="chevron-right" size={20} color={colors.textMuted} />
        </TouchableOpacity>
        <View style={literalStyles.s37}>
          {[{ label: 'Map & my location', icon: 'map', to: 'Maps' }, { label: 'Phrases', icon: 'globe', to: 'Phrases' }].map((b) => (
            <TouchableOpacity key={b.to} onPress={() => navigation.navigate(b.to)} style={[literalStyles.s38, { borderColor: night ? BORDERCOLOR_5A0E0E : BORDERCOLOR_0F766E }, literalStyles.s39]}>
              <Icon name={b.icon} size={20} color={night ? '#FF3B3B' : '#0F766E'} />
              <Text style={[{ color: colors.text }, literalStyles.s40]}>{b.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {shown.length === 0 && <Text style={[{ color: colors.textSecondary }, literalStyles.s41]}>No card matches. Try a simpler word, or ask the Atlas agent in a chat.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
};

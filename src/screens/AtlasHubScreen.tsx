import React, { useEffect, useState } from 'react';
import { StyleSheet, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { useEmergencyColors, useOffGrid } from '../atlasTools/offGrid';
import { OffGridCard } from '../components/OffGridCard';
import { deviceHasCompass } from './CompassScreen';
import { useAgentStore } from '../stores/agentStore';
import { installAtlasStarter } from '../learning/starter';
const BACKGROUNDCOLOR_1E0202 = '#1E0202';
const BORDERWIDTH_1 = 1;
const BORDERWIDTH_0 = 0;
const BORDERCOLOR_5A0E0E = '#5A0E0E';
const COLOR_FF6B6B = '#FF6B6B';
const COLOR_FFF = '#fff';
const COLOR_C04040 = '#C04040';
const COLOR_RGBA_255_255_255_0_85 = 'rgba(255,255,255,0.85)';
const literalStyles = StyleSheet.create({
  s1: { flex: 1 },
  s2: { flexDirection: 'row', alignItems: 'center', padding: 12 },
  s3: { padding: 6 },
  s4: { marginLeft: 8, flex: 1 },
  s5: { fontSize: 24, fontWeight: '700', fontFamily: 'serif' },
  s6: { fontSize: 13 },
  s7: { padding: 12, paddingBottom: 40, width: '100%', maxWidth: 1100, alignSelf: 'center' },
  s8: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6 },
  s9: { borderColor: BORDERCOLOR_5A0E0E, borderRadius: 16, padding: 16, minHeight: 112, justifyContent: 'space-between' },
  s10: { fontSize: 18, fontWeight: '700', marginTop: 10 },
  s11: { fontSize: 12, marginTop: 2 },
  s12: { marginTop: 12 },
  s13: { flexDirection: 'row', alignItems: 'center' },
  s14: { borderRadius: 12, padding: 14, marginBottom: 10 },
  s15: { flex: 1, marginLeft: 12 },
  s16: { fontSize: 16, fontWeight: '600' },
  s17: { borderRadius: 12, padding: 14 },
});


/** Atlas: everything for emergencies, travel and life off the grid, in one place. */
export const AtlasHubScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors: base } = useTheme();
  const colors = useEmergencyColors(base);
  const night = useOffGrid((s) => s.nightRed);
  const { width } = useWindowDimensions();
  const cols = width >= 900 ? 4 : width >= 600 ? 3 : 2;
  const [hasCompass, setHasCompass] = useState(false);
  useEffect(() => { void deviceHasCompass().then(setHasCompass).catch(() => setHasCompass(false)); }, []);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tiles = [
    { label: 'Emergency', sub: 'Bleeding, CPR, burns, water...', icon: 'alert-octagon', color: '#B91C1C', to: 'Emergency' },
    { label: 'Survival Manual', sub: 'Water, fire, shelter, food, plants', icon: 'book-open', color: '#3F6212', to: 'SurvivalManual' },
    { label: 'Maps', sub: 'Offline maps, GPS, saved places', icon: 'map', color: '#0F766E', to: 'Maps' },
    { label: 'Phrases', sub: 'Show or speak in 10+ languages', icon: 'globe', color: '#1D4ED8', to: 'Phrases' },
    ...(hasCompass ? [{ label: 'Compass', sub: 'Works with no signal', icon: 'compass', color: '#6D28D9', to: 'Compass' }] : []),
    { label: 'Offline Library', sub: 'Atlas packs, WikiMed, Wikipedia', icon: 'database', color: '#92400E', to: 'OfflineLibrary' },
    { label: 'Daily briefing', sub: 'Your news, read aloud, with fun facts', icon: 'radio', color: '#BE185D', to: 'DailyBrief' },
  ];

  const addCards = async () => {
    setBusy(true);
    try {
      const r = await installAtlasStarter(setMsg);
      setMsg(`Done: ${r.added} documents added${r.skipped ? `, ${r.skipped} already there` : ''}. Chats in the "Atlas - Emergency" project can quote them.`);
    } catch (e: any) { setMsg(`Could not add them: ${String(e?.message || e)}`); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={[literalStyles.s1, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={literalStyles.s2}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={literalStyles.s3}><Icon name="arrow-left" size={22} color={colors.text} /></TouchableOpacity>
        <View style={literalStyles.s4}>
          <Text style={[{ color: colors.text }, literalStyles.s5]}>Atlas</Text>
          <Text style={[{ color: colors.textSecondary }, literalStyles.s6]}>Emergencies, travel and off-grid life. All of it works offline.</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={literalStyles.s7}>
        <View style={literalStyles.s8}>
          {tiles.map((t) => (
            <View key={t.to} style={[{ width: `${100 / cols}%` }, literalStyles.s3]}>
              <TouchableOpacity onPress={() => navigation.navigate(t.to)} activeOpacity={0.8}
                style={[{ backgroundColor: night ? BACKGROUNDCOLOR_1E0202 : t.color, borderWidth: night ? BORDERWIDTH_1 : BORDERWIDTH_0 }, literalStyles.s9]}>
                <Icon name={t.icon} size={26} color={night ? '#FF3B3B' : '#fff'} />
                <View>
                  <Text style={[{ color: night ? COLOR_FF6B6B : COLOR_FFF }, literalStyles.s10]}>{t.label}</Text>
                  <Text style={[{ color: night ? COLOR_C04040 : COLOR_RGBA_255_255_255_0_85 }, literalStyles.s11]} numberOfLines={2}>{t.sub}</Text>
                </View>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        <View style={literalStyles.s12}><OffGridCard /></View>

        <TouchableOpacity onPress={() => { setActiveAgent('atlas'); navigation.navigate('Main', { screen: 'ChatsTab' }); }}
          style={[literalStyles.s13, { backgroundColor: colors.surface }, literalStyles.s14]}>
          <Icon name="message-circle" size={20} color={colors.primary} />
          <View style={literalStyles.s15}>
            <Text style={[{ color: colors.text }, literalStyles.s16]}>Ask the Atlas agent{activeAgentId === 'atlas' ? ' (active)' : ''}</Text>
            <Text style={[{ color: colors.textSecondary }, literalStyles.s6]}>Makes Atlas the active agent and opens your chats.</Text>
          </View>
          <Icon name="chevron-right" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity onPress={addCards} disabled={busy}
          style={[literalStyles.s13, { backgroundColor: colors.surface }, literalStyles.s17]}>
          <Icon name="download" size={20} color={colors.primary} />
          <View style={literalStyles.s15}>
            <Text style={[{ color: colors.text }, literalStyles.s16]}>{busy ? 'Adding...' : 'Give the AI the emergency cards'}</Text>
            <Text style={[{ color: colors.textSecondary }, literalStyles.s6]}>{msg ?? 'Creates the "Atlas - Emergency" project with all cards and the Survival Manual so answers can quote them. Takes a minute.'}</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { listVoices, speakAndWait, stop as stopSpeech, type TtsVoice } from '../atlasVoice/tts';
import { hostVoices, voiceLabel } from '../atlasVoice/neural';
import { useAtlasVoiceStore } from '../atlasVoice/store';

const ROLES = ['Host A (anchor)', 'Host B', 'Host C'];

/** One voice button. Memoized: a natural voice model lists dozens of voices for each host, and re-drawing all of them on every tap was the lag. */
const VoiceChip = memo(function VoiceChip({ role, roleIndex, name, label, on, onPick, styles, color }: {
  role: string; roleIndex: number; name: string; label: string; on: boolean;
  onPick: (role: number, name: string) => void; styles: any; color: string;
}) {
  return (
    <TouchableOpacity onPress={() => onPick(roleIndex, name)} style={[styles.chip, on && styles.chipOn]}
      accessibilityLabel={`${role}: ${label}`} accessibilityState={{ selected: on }} testID={`voice-${roleIndex}-${name}`}>
      {on && <Icon name="volume-2" size={12} color={color} />}
      <Text style={on ? styles.chipTextOn : styles.chipText}>{label}</Text>
    </TouchableOpacity>
  );
});

/**
 * Choose the voice of each podcast and briefing host. Tap a voice to pick it and hear it.
 * The choice is kept with the voice settings; a voice that is later removed falls back to
 * the automatic pick.
 */
export function PodcastVoicePicker({ hosts = 3 }: { hosts?: number }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const chosen = useAtlasVoiceStore((s) => s.podcastVoices);
  // What is shown as picked changes the moment a voice is tapped, before the saved setting and the preview catch up.
  const [shown, setShown] = useState<string[] | null>(null);
  useEffect(() => { listVoices('en').then(setVoices).catch(() => undefined); }, []);
  useEffect(() => { setShown(null); }, [chosen]);
  const stored = useMemo(() => (voices.length >= 2 ? hostVoices(voices) : []), [voices, chosen]); // eslint-disable-line react-hooks/exhaustive-deps
  const current = shown ?? stored;
  const pick = useCallback((role: number, name: string) => {
    const next = [...(shown ?? stored)];
    next[role] = name;
    setShown(next);
    // Save and speak after the button has redrawn; the previous preview is cut off so previews do not queue up.
    setTimeout(() => {
      useAtlasVoiceStore.getState().setPodcastVoices(next);
      stopSpeech();
      speakAndWait(`Hello, I'm ${ROLES[role].replace(/ \(.*\)/, '')}.`, 1, 'podcast', name).catch(() => undefined);
    }, 0);
  }, [shown, stored]);
  if (voices.length < 2) return null;
  return (
    <View testID="podcast-voice-picker">
      {ROLES.slice(0, Math.max(1, Math.min(3, hosts))).map((role, i) => (
        <View key={role} style={styles.row}>
          <Text style={styles.label}>{role}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {voices.map((v, k) => {
              const on = current[i] === v.name;
              return <VoiceChip key={v.name} role={role} roleIndex={i} name={v.name} label={voiceLabel(v.name, k)} on={on} onPick={pick} styles={styles} color={colors.background} />;
            })}
          </ScrollView>
        </View>
      ))}
      {chosen.length > 0 && (
        <TouchableOpacity onPress={() => useAtlasVoiceStore.getState().setPodcastVoices([])}>
          <Text style={styles.reset}>Use automatic voices</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  row: { marginTop: SPACING.sm, gap: SPACING.xs },
  label: { ...TYPOGRAPHY.meta, color: colors.textSecondary },
  chips: { gap: SPACING.xs, paddingRight: SPACING.md },
  chip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs,
    borderRadius: 16, borderWidth: 1, borderColor: colors.border,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...TYPOGRAPHY.bodySmall, color: colors.text },
  chipTextOn: { ...TYPOGRAPHY.bodySmall, color: colors.background },
  reset: { ...TYPOGRAPHY.bodySmall, color: colors.primary, marginTop: SPACING.sm },
});

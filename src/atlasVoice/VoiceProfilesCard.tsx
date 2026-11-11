import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import { useAtlasVoiceStore } from './store';
import { missingPresets, useVoiceProfiles, type VoiceProfile } from './profiles';
import { KOKORO_V1_PRESETS, findNeuralVoice, loadVoiceForSpeech, restoreSavedVoice, useNeuralVoices } from './neural';
import { speak } from './tts';

/** Human label for a profile's voice, e.g. "KittenTTS Nano · Kitten 3 · 1.25x". */
export function describeProfile(p: Pick<VoiceProfile, 'voiceId' | 'sid' | 'rate'>): string {
  const voice = findNeuralVoice(p.voiceId);
  const speaker = voice?.speakers?.find((k) => k.sid === p.sid)?.name ?? (voice?.imported && p.sid > 0 ? `Speaker ${p.sid + 1}` : undefined);
  return [voice?.name ?? 'Phone voice', speaker, `${p.rate}x`].filter(Boolean).join(' · ');
}

/** Plays a short sample in a profile's voice, then returns to the saved voice. */
export async function previewProfile(p: VoiceProfile): Promise<void> {
  await loadVoiceForSpeech(p.voiceId, p.sid);
  speak(`Hi, I'm ${p.name}. This is how I sound.`, 'voice-test', p.rate);
  const unsub = useAtlasVoiceStore.subscribe((s) => {
    if (s.speakingKey) return;
    unsub();
    restoreSavedVoice().catch(() => undefined);
  });
}

/** Models -> Voice: save the current voice as a named profile and manage saved profiles. */
export function VoiceProfilesCard() {
  const { colors } = useTheme();
  const profiles = useVoiceProfiles((s) => s.profiles);
  const { addProfile, removeProfile, addPresets } = useVoiceProfiles.getState();
  const hasKokoroV1 = useNeuralVoices((s) => s.installed['kokoro-v1-en'] !== undefined);
  const presets = hasKokoroV1 ? missingPresets(profiles, KOKORO_V1_PRESETS) : [];
  const voiceId = useAtlasVoiceStore((s) => s.neuralVoice);
  const sid = useAtlasVoiceStore((s) => s.neuralSid);
  const rate = useAtlasVoiceStore((s) => s.rate);
  const [name, setName] = useState('');
  const save = () => {
    if (!name.trim()) return;
    addProfile({ name, voiceId, sid, rate });
    setName('');
  };
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="voice-profiles-card">
      <Text style={[styles.h, { color: colors.text }]}>Voice profiles</Text>
      <Text style={[styles.p, { color: colors.textSecondary }]}>
        Save the voice, speaker and speed chosen above under a name, then give it to an agent (Agents → edit) so
        that agent's answers are read in its own voice. Profiles stay on this device.
      </Text>
      <Text style={[styles.p, styles.current, { color: colors.textMuted }]}>Current: {describeProfile({ voiceId, sid, rate })}</Text>
      <View style={styles.row}>
        <TextInput
          testID="voice-profile-name"
          value={name}
          onChangeText={setName}
          placeholder="Profile name, e.g. Calm coach"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { color: colors.text, borderColor: colors.border }]}
        />
        <TouchableOpacity testID="voice-profile-save" onPress={save} disabled={!name.trim()} style={[styles.btn, !name.trim() && styles.disabled, { borderColor: colors.primary }]}>
          <Text style={{ color: colors.primary }}>Save</Text>
        </TouchableOpacity>
      </View>
      {presets.length > 0 && (
        <TouchableOpacity testID="voice-profile-presets" onPress={() => addPresets(presets)} style={[styles.btn, styles.presets, { borderColor: colors.primary }]}>
          <Text style={{ color: colors.primary }}>Add ready-made: {presets.map((p) => p.name).join(', ')}</Text>
        </TouchableOpacity>
      )}
      {profiles.map((p) => (
        <View key={p.id} style={[styles.profile, { borderColor: colors.border }]}>
          <View style={styles.flex}>
            <Text style={[styles.name, { color: colors.text }]}>{p.name}</Text>
            <Text style={[styles.meta, { color: colors.textMuted }]}>{describeProfile(p)}</Text>
          </View>
          <TouchableOpacity onPress={() => { previewProfile(p).catch(() => undefined); }} style={styles.action}>
            <Text style={{ color: colors.primary }}>Preview</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => Alert.alert('Delete profile?', p.name, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => removeProfile(p.id) },
            ])}
            style={styles.action}
          >
            <Text style={{ color: colors.textMuted }}>Delete</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 10, padding: 14, marginBottom: 12 },
  h: { fontSize: 15, fontWeight: '600', marginBottom: 6 },
  p: { fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  input: { flex: 1, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  btn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 9 },
  presets: { marginTop: 10 },
  current: { marginTop: 6 },
  disabled: { opacity: 0.5 },
  name: { fontWeight: '600' },
  meta: { fontSize: 12 },
  profile: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 10 },
  flex: { flex: 1, paddingRight: 8 },
  action: { paddingHorizontal: 8, paddingVertical: 6 },
});

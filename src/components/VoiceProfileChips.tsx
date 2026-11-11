import React from 'react';
import { StyleSheet, ScrollView, Text, TouchableOpacity } from 'react-native';
import { useVoiceProfiles } from '../atlasVoice/profiles';
const literalStyles = StyleSheet.create({
  s1: { marginBottom: 4 },
  s2: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, marginRight: 8 },
  s3: { maxWidth: 220 },
  s4: { fontSize: 13, paddingVertical: 7 },
});

const WHITE = '#ffffff';
const chipText = { fontSize: 13 };

/** Horizontal picker of saved voice profiles ('' = the saved app voice). */
export function VoiceProfileChips({ value, onChange, colors }: {
  value: string; onChange: (id: string) => void; colors: any;
}) {
  const profiles = useVoiceProfiles((s) => s.profiles);
  const items = [{ id: '', name: 'App voice' }, ...profiles.map((p) => ({ id: p.id, name: p.name }))];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={literalStyles.s1} testID="voice-profile-chips">
      {items.map((p) => {
        const on = p.id === value;
        return (
          <TouchableOpacity
            key={p.id || 'app'}
            onPress={() => onChange(p.id)}
            style={[literalStyles.s2, { backgroundColor: on ? colors.primary : colors.surface }, literalStyles.s3]}
          >
            <Text numberOfLines={1} style={[chipText, { color: on ? WHITE : colors.text }]}>{p.name}</Text>
          </TouchableOpacity>
        );
      })}
      {profiles.length === 0 && <Text style={[{ color: colors.textMuted }, literalStyles.s4]}>No voice profiles yet.</Text>}
    </ScrollView>
  );
}

import React from 'react';
import { StyleSheet, ScrollView, Text, TouchableOpacity } from 'react-native';
import { useAppStore } from '../stores/appStore';
const COLOR_FFF = '#fff';
const literalStyles = StyleSheet.create({
  s1: { marginBottom: 4 },
  s2: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, marginRight: 8 },
  s3: { maxWidth: 260 },
  s4: { fontSize: 13 },
  s5: { fontSize: 13, paddingVertical: 7 },
});


/** Horizontal chip picker of downloaded text models. '' = "Current model". */
export function ModelChips({ value, onChange, colors, emptyLabel = 'Current model', disabled }: {
  value: string; onChange: (id: string) => void; colors: any; emptyLabel?: string; disabled?: boolean;
}) {
  const models = useAppStore((s) => s.downloadedModels);
  const items = [{ id: '', name: emptyLabel }, ...models.map((m) => ({ id: m.id, name: m.name }))];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={literalStyles.s1}>
      {items.map((m) => {
        const on = m.id === value;
        return (
          <TouchableOpacity
            key={m.id || 'current'}
            disabled={disabled}
            onPress={() => onChange(m.id)}
            style={[literalStyles.s2, { backgroundColor: on ? colors.primary : colors.surface }, literalStyles.s3]}
          >
            <Text numberOfLines={1} style={[{ color: on ? COLOR_FFF : colors.text }, literalStyles.s4]}>{m.name}</Text>
          </TouchableOpacity>
        );
      })}
      {models.length === 0 && <Text style={[{ color: colors.textMuted }, literalStyles.s5]}>No models downloaded yet.</Text>}
    </ScrollView>
  );
}

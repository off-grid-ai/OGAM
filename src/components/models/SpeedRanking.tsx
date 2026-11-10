/** "Fastest on this phone": downloaded models ranked by the writing speed Atlas measured while chatting. */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../theme';
import { useAppStore } from '../../stores';
import { useSpeedStats, speedHealthLabel, type ModelSpeed } from '../../atlasTools/speed';
const literalStyles = StyleSheet.create({
  s1: { fontSize: 16 },
  s2: { fontSize: 12, marginTop: 2 },
  s3: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  s4: { width: 22 },
  s5: { flex: 1 },
});


export interface RankedModel { id: string; name: string; decode: number; prefill: number }

/** Measured models only, fastest writer first. */
export function rankModelsBySpeed(models: Array<{ id: string; name: string }>, speeds: Record<string, ModelSpeed>): RankedModel[] {
  return models
    .map(m => ({ id: m.id, name: m.name, decode: speeds[m.id]?.decode ?? 0, prefill: speeds[m.id]?.prefill ?? 0 }))
    .filter(m => m.decode > 0)
    .sort((a, b) => b.decode - a.decode);
}

export const SpeedRankingCard: React.FC<{ style?: object }> = ({ style }) => {
  const { colors } = useTheme();
  const models = useAppStore(s => s.downloadedModels);
  const speeds = useSpeedStats(s => s.byModel);
  const ranked = rankModelsBySpeed(models, speeds).slice(0, 6);
  if (!ranked.length) return null;
  return (
    <View style={style} testID="speed-ranking">
      <Text style={[{ color: colors.text }, literalStyles.s1]}>Fastest on this phone</Text>
      <Text style={[{ color: colors.textMuted }, literalStyles.s2]}>Measured while you chat. Word-pieces per second.</Text>
      {ranked.map((m, i) => (
        <View key={m.id} style={literalStyles.s3}>
          <Text style={[{ color: i === 0 ? colors.primary : colors.textMuted }, literalStyles.s4]}>{i + 1}.</Text>
          <Text style={[{ color: colors.text }, literalStyles.s5]} numberOfLines={1}>{m.name}</Text>
          <Text style={{ color: colors.textSecondary }}>
            {m.decode.toFixed(1)} writing · {speedHealthLabel(m.decode)}{m.prefill > 0 ? ` · reads ${Math.round(m.prefill)}` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
};

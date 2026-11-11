import React from 'react';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import { useLowPower, checkBatteryNow, batteryModel } from '../atlasTools/lowPower';
import { useAppStore } from '../stores/appStore';
import { ModelChips } from './ModelChips';
const COLOR_FFF = '#fff';
const literalStyles = StyleSheet.create({
  s1: { flex: 1 },
});


/** Settings card for low-battery mode. */
export function LowPowerCard() {
  const { colors } = useTheme();
  const s = useLowPower();
  const models = useAppStore((x) => x.downloadedModels);
  const best = s.enabled && !s.modelId ? batteryModel() : null;
  const bestName = best ? models.find((m) => m.id === best.id)?.name : null;
  return (
    <View style={[st.card, { backgroundColor: colors.surface }]}>
      <View style={st.row}>
        <View style={literalStyles.s1}>
          <Text style={[st.h, { color: colors.text }]}>Low-battery mode</Text>
          <Text style={[st.p, { color: colors.textSecondary }]}>
            Below {s.threshold}% (not charging): smaller model, short answers, hands-free off.
            {s.battery !== null ? `  Battery now: ${s.battery}%${s.charging ? ' (charging)' : ''}.` : ''}
            {s.enabled && s.active ? '  ACTIVE NOW.' : ''}
            {'  Always on in off-grid mode.'}
          </Text>
        </View>
        <Switch value={s.enabled} onValueChange={(v) => { s.set({ enabled: v }); setTimeout(() => checkBatteryNow(), 100); }} />
      </View>
      {s.enabled && (
        <>
          <Text style={[st.label, { color: colors.textSecondary }]}>Turn on at</Text>
          <View style={st.row}>
            {[10, 15, 20, 30, 40].map((n) => (
              <TouchableOpacity key={n} onPress={() => s.set({ threshold: n })} style={[st.pill, { backgroundColor: s.threshold === n ? colors.primary : colors.background }]}>
                <Text style={{ color: s.threshold === n ? COLOR_FFF : colors.text }}>{n}%</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[st.label, { color: colors.textSecondary }]}>Answer length limit</Text>
          <View style={st.row}>
            {[128, 256, 512].map((n) => (
              <TouchableOpacity key={n} onPress={() => s.set({ maxTokens: n })} style={[st.pill, { backgroundColor: s.maxTokens === n ? colors.primary : colors.background }]}>
                <Text style={{ color: s.maxTokens === n ? COLOR_FFF : colors.text }}>{n} tokens</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[st.label, { color: colors.textSecondary }]}>Switch to this smaller model</Text>
          <ModelChips value={s.modelId} onChange={(id) => s.set({ modelId: id })} colors={colors} emptyLabel="Automatic" />
          {!s.modelId && (
            <Text style={[st.p, { color: colors.textMuted }]}>
              {bestName ? `Automatic: switches to ${bestName} (${best!.why}).` : 'Automatic: picks your fastest model once Atlas has timed a few answers.'}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: 10, padding: 14, marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  h: { fontSize: 15, fontWeight: '600' },
  p: { fontSize: 13, lineHeight: 18, marginTop: 4 },
  label: { fontSize: 12, marginTop: 12, marginBottom: 6, textTransform: 'uppercase' },
  pill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16 },
});

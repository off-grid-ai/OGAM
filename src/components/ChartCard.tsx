import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme';
import { chartCaption, parseChart, shares, type ChartSpec } from '../study/chart';
const literalStyles = StyleSheet.create({
  s1: { height: 10, borderRadius: 5 },
});


const PALETTE = ['#2563EB', '#D97706', '#16A34A', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D'];
const st = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 10, padding: 12, marginVertical: 8 }, title: { fontWeight: '600', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 6 }, dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  barTrack: { flex: 1, height: 10, borderRadius: 5, marginHorizontal: 8 }, cap: { fontSize: 12, marginTop: 8 }, pie: { alignItems: 'center' },
});

const slice = (c: { cx: number; cy: number; r: number }, a0: number, a1: number) => {
  const { cx, cy, r } = c;
  const p = (a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  return `M ${cx} ${cy} L ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)} Z`;
};

export const ChartCard: React.FC<{ spec: ChartSpec }> = ({ spec }) => {
  const { colors } = useTheme();
  const pct = shares(spec.type === 'pie' ? spec.values : spec.values.map(() => 1));
  const max = Math.max(...spec.values.map(Math.abs), 1);
  let angle = -Math.PI / 2; const total = spec.values.reduce((s, v) => s + v, 0);
  const fmt = (v: number) => `${v}${spec.unit ? ` ${spec.unit}` : ''}`;
  return (
    <View testID="chart-card" style={[st.card, { borderColor: colors.border }]}>
      {!!spec.title && <Text style={[st.title, { color: colors.text }]}>{spec.title}</Text>}
      {spec.type === 'pie' && <View style={st.pie}><Svg width={160} height={160}>{spec.values.map((v, i) => {
        const a1 = angle + (v / total) * Math.PI * 2; const d = slice({ cx: 80, cy: 80, r: 76 }, angle, Math.min(a1, angle + Math.PI * 2 - 0.0001)); angle = a1;
        return v > 0 ? <Path key={i} d={d} fill={PALETTE[i % PALETTE.length]} /> : null;
      })}</Svg></View>}
      {spec.labels.map((l, i) => (
        <View key={i} style={st.row}>
          <View style={[st.dot, { backgroundColor: PALETTE[i % PALETTE.length] }]} />
          <Text style={{ color: colors.text }}>{l}</Text>
          {spec.type !== 'pie' && <View style={[st.barTrack, { backgroundColor: colors.surfaceLight }]}><View style={[{ width: `${Math.max(2, (Math.abs(spec.values[i]) / max) * 100)}%` }, literalStyles.s1, { backgroundColor: PALETTE[i % PALETTE.length] }]} /></View>}
          <Text style={{ color: colors.textSecondary }}>{spec.type === 'pie' ? `  ${pct[i]}% (${fmt(spec.values[i])})` : fmt(spec.values[i])}</Text>
        </View>
      ))}
      <Text style={[st.cap, { color: spec.source ? colors.textMuted : colors.error }]}>{chartCaption(spec)}</Text>
    </View>
  );
};

/** Renders a ```chart block, or says why it could not be drawn. */
export const ChartBlock: React.FC<{ content: string }> = ({ content }) => {
  const { colors } = useTheme();
  const r = parseChart(content);
  return r.chart ? <ChartCard spec={r.chart} /> : <Text style={{ color: colors.error }}>{r.error}</Text>;
};

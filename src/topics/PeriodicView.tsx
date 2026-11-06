import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useTheme } from '../theme';
import { Button } from '../components/Button';
import { GOOD } from '../components/games/kit';
import { ELEMENTS } from '../study/science';
import { tablePosition, type PeriodicQuestion } from '../study/periodicQuiz';
import { starsForShare } from './formats';

const GROUP_COLORS: Record<string, string> = {
  'alkali metal': '#DC2626', 'alkaline earth metal': '#EA580C', 'transition metal': '#CA8A04', 'post-transition metal': '#65A30D', metalloid: '#0D9488',
  nonmetal: '#2563EB', halogen: '#7C3AED', 'noble gas': '#DB2777', lanthanide: '#0891B2', actinide: '#6366F1',
};
const st = StyleSheet.create({ gap: { gap: 10 }, grid: { alignSelf: 'center' }, row: { flexDirection: 'row' }, cell: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 3 }, symbol: { fontWeight: '600' }, legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, key: { flexDirection: 'row', alignItems: 'center', gap: 4 }, swatch: { width: 10, height: 10, borderRadius: 2 } });

/** A real periodic table to tap. Cells show the symbol only, so the question is not answered by reading the cell. */
export function PeriodicView({ content, onDone }: { content: { questions: PeriodicQuestion[] }; onDone: (stars: 1 | 2 | 3) => void }) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const [i, setI] = useState(0);
  const [tapped, setTapped] = useState<string | null>(null);
  const [wrong, setWrong] = useState(0);
  const [firstTry, setFirstTry] = useState(true);
  const [right, setRight] = useState(0);
  const q = content.questions[i];
  const cell = Math.max(14, Math.floor((width - 32) / 18) - 1);
  const grid = useMemo(() => {
    const rows: Array<Array<(typeof ELEMENTS)[number] | null>> = Array.from({ length: 10 }, () => Array(18).fill(null));
    for (const e of ELEMENTS) { const p = tablePosition(e); rows[p.row][p.col] = e; }
    return rows;
  }, []);
  if (!q) return null;
  const last = i === content.questions.length - 1;
  const done = tapped === q.answer;
  const tap = (symbol: string) => {
    if (done) return;
    setTapped(symbol);
    if (symbol === q.answer) { if (firstTry) setRight((r) => r + 1); } else { setWrong((w) => w + 1); setFirstTry(false); }
  };
  const next = () => { if (last) { onDone(starsForShare(right / content.questions.length)); return; } setI(i + 1); setTapped(null); setFirstTry(true); };
  return (
    <ScrollView contentContainerStyle={st.gap} testID="square-periodic">
      <Text style={{ color: colors.textSecondary }}>{i + 1} of {content.questions.length}</Text>
      <Text style={{ color: colors.text, fontSize: 17 }} testID="periodic-prompt">{q.prompt}</Text>
      <View style={st.grid}>
        {grid.map((row, r) => (
          <View key={r} style={[st.row, r === 7 ? { height: 6 } : null]}>
            {r === 7 ? null : row.map((e, c) => {
              if (!e) return <View key={c} style={{ width: cell, height: cell }} />;
              const isTapped = tapped === e.symbol;
              const correct = isTapped && e.symbol === q.answer;
              return (
                <TouchableOpacity key={c} testID={`el-${e.symbol}`} accessibilityLabel={e.symbol} onPress={() => tap(e.symbol)}
                  style={[st.cell, { width: cell, height: cell, borderColor: isTapped ? (correct ? GOOD : colors.error) : colors.border, backgroundColor: `${GROUP_COLORS[e.category]}${isTapped ? 'FF' : '33'}` }]}>
                  <Text style={[st.symbol, { fontSize: Math.max(7, cell * 0.38), color: isTapped ? '#fff' : colors.text }]}>{e.symbol}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
      <View style={st.legend} testID="periodic-legend">
        {Object.entries(GROUP_COLORS).map(([name, color]) => (
          <View key={name} style={st.key}><View style={[st.swatch, { backgroundColor: color }]} /><Text style={{ color: colors.textMuted, fontSize: 11 }}>{name}</Text></View>
        ))}
      </View>
      {tapped && !done && <Text style={{ color: colors.error }} testID="periodic-wrong">Not that one. Try again.</Text>}
      {done && <Text style={{ color: GOOD }} testID="periodic-right">Correct. {q.explain}</Text>}
      {done && <Button title={last ? 'Finish' : 'Next'} onPress={next} testID={last ? 'periodic-done' : 'periodic-next'} />}
      {wrong > 0 && !done && <Text style={{ color: colors.textMuted, fontSize: 12 }}>{wrong} wrong tap{wrong === 1 ? '' : 's'} so far</Text>}
    </ScrollView>
  );
}

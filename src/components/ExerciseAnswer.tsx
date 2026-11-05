import React from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../theme';
import type { Exercise, TableRow, Verdict } from '../study/exercises';

export type Colors = ReturnType<typeof useTheme>['colors'];
export const good = '#16A34A';
export const st = StyleSheet.create({
  flex: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', padding: 12 }, title: { fontSize: 18, marginLeft: 12 }, content: { padding: 16, paddingBottom: 120 },
  choice: { borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 6 }, input: { borderWidth: 1, borderRadius: 8, padding: 10 },
  pill: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, margin: 3 }, wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  top4: { marginTop: 4 }, top6: { marginTop: 6 }, top8: { marginTop: 8 }, top10: { marginTop: 10 }, top12: { marginTop: 12 }, top14: { marginTop: 14 }, top18: { marginTop: 18 }, pad8: { paddingVertical: 8 },
  gap: { marginLeft: 8 }, semi: { fontWeight: '600' }, small12: { fontSize: 12 }, small13: { fontSize: 13 }, prompt: { fontSize: 17, marginTop: 6 },
});

/** One input per kind. The draft is saved as it changes so leaving the screen loses nothing. */
export const Answer: React.FC<{ ex: Exercise; value: any; onChange: (v: any) => void; verdict?: Verdict; colors: Colors }> = ({ ex, value, onChange, verdict, colors }) => {
  const box = (ok?: boolean) => ({ borderWidth: 1, borderColor: ok === undefined ? colors.border : ok ? good : colors.error, borderRadius: 8, padding: 10, color: colors.text, marginTop: 6 });
  const choose = ({ label, on, press, key }: { label: string; on: boolean; press: () => void; key: string }) => (
    <TouchableOpacity key={key} onPress={press} style={[st.choice, { borderColor: on ? colors.primary : colors.border }]}>
      <Text style={{ color: colors.text }}>{label}</Text>
    </TouchableOpacity>
  );
  switch (ex.kind) {
    case 'mcq': return <View>{ex.choices.map((c, i) => choose({ label: c, on: value === i, press: () => onChange(i), key: String(i) }))}</View>;
    case 'truefalse': return <View>{[true, false].map((b) => choose({ label: b ? 'True' : 'False', on: value === b, press: () => onChange(b), key: String(b) }))}</View>;
    case 'fill': case 'calc': case 'short':
      return <TextInput testID="practice-input" value={value ?? ''} onChangeText={onChange} multiline={ex.kind === 'short'} placeholder={ex.kind === 'calc' ? `Number${ex.unit ? ` (${ex.unit})` : ''}` : 'Your answer'} placeholderTextColor={colors.textMuted} keyboardType={ex.kind === 'calc' ? 'numeric' : 'default'} style={box(verdict?.correct)} />;
    case 'order': {
      const picked: string[] = value ?? [];
      const rest = [...ex.items].sort();
      return <View>
        <Text style={[st.top6, { color: colors.textSecondary }]}>Tap in the right order. Tap a chosen item to remove it.</Text>
        {picked.map((p, i) => choose({ label: `${i + 1}. ${p}`, on: true, press: () => onChange(picked.filter((_, k) => k !== i)), key: `p${i}` }))}
        {rest.filter((r) => !picked.includes(r)).map((r) => choose({ label: r, on: false, press: () => onChange([...picked, r]), key: r }))}
      </View>;
    }
    case 'match': {
      const got: Record<string, string> = value ?? {};
      const defs = ex.pairs.map((p) => p[1]).sort();
      return <View>{ex.pairs.map(([k], i) => (
        <View key={k} style={st.top8}>
          <Text style={{ color: verdict?.parts ? (verdict.parts[i] ? good : colors.error) : colors.text }}>{k}</Text>
          {defs.map((d) => choose({ label: d, on: got[k] === d, press: () => onChange({ ...got, [k]: d }), key: `${k}-${d}` }))}
        </View>))}</View>;
    }
    case 'table': {
      const rows: Array<{ account?: string; amount?: string }> = value ?? [];
      const set = (i: number, patch: object) => onChange(ex.rows.map((_, k) => (k === i ? { ...rows[k], ...patch } : rows[k] ?? {})));
      return <View>{ex.rows.map((row: TableRow, i) => (
        <View key={i} style={st.top10}>
          <Text style={{ color: verdict?.parts ? (verdict.parts[i] ? good : colors.error) : colors.text }}>{row.label}</Text>
          {row.options?.length ? <View style={st.wrap}>{row.options.map((o) => (
            <TouchableOpacity key={o} onPress={() => set(i, { account: o })} style={[st.pill, { borderColor: rows[i]?.account === o ? colors.primary : colors.border }]}>
              <Text style={[st.small13, { color: colors.text }]}>{o}</Text></TouchableOpacity>))}</View> : null}
          <TextInput value={rows[i]?.amount ?? ''} onChangeText={(t) => set(i, { amount: t })} keyboardType="numeric" placeholder="Amount" placeholderTextColor={colors.textMuted} style={box(verdict?.parts?.[i])} />
        </View>))}</View>;
    }
    case 'testlet': {
      const parts: any[] = value ?? [];
      return <View><Text style={[st.top6, { color: colors.text }]}>{ex.stem}</Text>{ex.items.map((it, i) => (
        <View key={it.id ?? i} style={st.top12}>
          <Text style={[st.semi, { color: verdict?.parts ? (verdict.parts[i] ? good : colors.error) : colors.text }]}>{i + 1}. {it.prompt}</Text>
          <Answer ex={it} value={parts[i]} onChange={(v) => onChange(ex.items.map((_, k) => (k === i ? v : parts[k])))} colors={colors} />
        </View>))}</View>;
    }
  }
};

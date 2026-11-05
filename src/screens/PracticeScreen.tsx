import React, { useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { Button } from '../components/Button';
import { CitationChips } from '../components/CitationChips';
import { useProjectStore } from '../stores';
import { check, practiceSet, topicScores, useExerciseStore, type Exercise, type TableRow, type Verdict } from '../study/exercises';
import { generatePractice } from '../study/practice';
import { ACCOUNTING_DRILLS, STATS_DRILLS, makeDrillSet, type DrillKind } from '../study/drills';

type Colors = ReturnType<typeof useTheme>['colors'];
const good = '#16A34A';
const st = StyleSheet.create({
  flex: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', padding: 12 }, title: { fontSize: 18, marginLeft: 12 }, content: { padding: 16, paddingBottom: 120 },
  choice: { borderWidth: 1, borderRadius: 8, padding: 10, marginTop: 6 }, input: { borderWidth: 1, borderRadius: 8, padding: 10 },
  pill: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, margin: 3 }, wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  top4: { marginTop: 4 }, top6: { marginTop: 6 }, top8: { marginTop: 8 }, top10: { marginTop: 10 }, top12: { marginTop: 12 }, top14: { marginTop: 14 }, top18: { marginTop: 18 }, pad8: { paddingVertical: 8 },
  semi: { fontWeight: '600' }, small12: { fontSize: 12 }, small13: { fontSize: 13 }, prompt: { fontSize: 17, marginTop: 6 },
});

/** One input per kind. The draft is saved as it changes so leaving the screen loses nothing. */
const Answer: React.FC<{ ex: Exercise; value: any; onChange: (v: any) => void; verdict?: Verdict; colors: Colors }> = ({ ex, value, onChange, verdict, colors }) => {
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

export const PracticeScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { projectId } = useRoute<any>().params as { projectId: string };
  const { colors } = useTheme();
  const project = useProjectStore((s) => s.projects.find((p) => p.id === projectId));
  const { exercises, progress, addSet, record, saveDraft } = useExerciseStore();
  const [topic, setTopic] = useState('');
  const [busy, setBusy] = useState(false);
  const [queue, setQueue] = useState<Exercise[]>([]);
  const [verdict, setVerdict] = useState<Verdict | undefined>();
  const [note, setNote] = useState('');
  const all = useMemo(() => Object.values(exercises), [exercises]);
  const current = queue[0];
  const scores = topicScores(all, progress);

  const make = async () => {
    setBusy(true); setNote('');
    try {
      const r = await generatePractice(projectId, topic);
      setNote(`${r.added} questions added${r.dropped ? `, ${r.dropped} skipped (${r.reasons.join(', ')})` : ''}.`);
      setQueue(practiceSet(Object.values(useExerciseStore.getState().exercises), useExerciseStore.getState().progress, { topic: topic.trim() || undefined }));
    } catch (e: any) { Alert.alert('Could not make questions', String(e?.message || e)); } finally { setBusy(false); }
  };
  const drills = (kinds: DrillKind[]) => { const set = makeDrillSet(8, Date.now() % 100000, kinds); addSet(set); setVerdict(undefined); setNote(''); setQueue(set); };
  const start = (t?: string) => { setVerdict(undefined); setQueue(practiceSet(all, progress, { topic: t })); if (!all.length) setNote('No questions yet. Make some from your documents.'); };
  const value = current ? progress[current.id]?.saved : undefined;
  const submit = () => { if (!current) return; const v = check(current, value); setVerdict(v); record(current.id, v.correct); };
  const next = () => { setVerdict(undefined); setQueue((q) => q.slice(1)); };

  return (
    <SafeAreaView style={[st.flex, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={[st.title, { color: colors.text }]}>Practice: {project?.name || ''}</Text>
      </View>
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        {!current ? (
          <View>
            <TextInput testID="practice-topic" value={topic} onChangeText={setTopic} placeholder="Topic or chapter (optional)" placeholderTextColor={colors.textMuted} style={[st.input, { borderColor: colors.border, color: colors.text }]} />
            <Button title={busy ? 'Writing questions...' : 'Make questions from my documents'} onPress={make} loading={busy} disabled={busy} testID="practice-make" style={st.top10} />
            <Button title="Accounting drills (balance sheet, interest, loans, statements...)" variant="outline" onPress={() => drills(ACCOUNTING_DRILLS)} testID="practice-drills" style={st.top8} />
            <Button title="Research statistics drills (doctoral courses)" variant="outline" onPress={() => drills(STATS_DRILLS)} testID="practice-stats-drills" style={st.top8} />
            <Button title="Practise what I have (missed and due first)" variant="outline" onPress={() => start(topic.trim() || undefined)} testID="practice-start" style={st.top8} />
            {!!note && <Text testID="practice-note" style={[st.top10, { color: colors.textSecondary }]}>{note}</Text>}
            {scores.length > 0 && <View style={st.top18}>
              <Text style={[st.semi, { color: colors.text }]}>Score by topic (weakest first)</Text>
              {scores.map((s) => <TouchableOpacity key={s.topic} onPress={() => start(s.topic)} style={st.pad8}>
                <Text style={{ color: s.percent < 60 ? colors.error : colors.text }}>{s.topic}: {s.percent}% ({s.attempts} tries)</Text></TouchableOpacity>)}
            </View>}
          </View>
        ) : (
          <View>
            <Text style={[st.small12, { color: colors.textMuted }]}>{queue.length} left{current.topic ? ` - ${current.topic}` : ''}</Text>
            <Text testID="practice-prompt" style={[st.prompt, { color: colors.text }]}>{current.kind === 'testlet' ? 'Answer all parts' : current.prompt}</Text>
            <Answer ex={current} value={value} onChange={(v) => saveDraft(current.id, v)} verdict={verdict} colors={colors} />
            {verdict && <View style={st.top14}>
              <Text testID="practice-result" style={[st.semi, { color: verdict.correct ? good : colors.error }]}>{verdict.correct ? 'Correct' : 'Not quite'}{verdict.note ? ` - ${verdict.note}` : ''}</Text>
              {!!current.explain && <Text style={[st.top4, { color: colors.textSecondary }]}>{current.explain}</Text>}
              {current.source && <CitationChips cites={[{ title: current.source.doc, page: current.source.page, section: current.source.section, quote: current.source.quote, verified: true }]} />}
            </View>}
            <Button title={verdict ? 'Next' : 'Check'} onPress={verdict ? next : submit} testID={verdict ? 'practice-next' : 'practice-check'} style={st.top14} />
            <Button title="Stop" variant="ghost" onPress={() => { setQueue([]); setVerdict(undefined); }} style={st.top6} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

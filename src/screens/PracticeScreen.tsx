import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { Button } from '../components/Button';
import { useProjectStore } from '../stores';
import { check, practiceSet, topicScores, useExerciseStore, type Exercise, type TableRow, type Verdict } from '../study/exercises';
import { generatePractice } from '../study/practice';

type Colors = ReturnType<typeof useTheme>['colors'];
const good = '#16A34A';

/** One input per kind. The draft is saved as it changes so leaving the screen loses nothing. */
const Answer: React.FC<{ ex: Exercise; value: any; onChange: (v: any) => void; verdict?: Verdict; colors: Colors }> = ({ ex, value, onChange, verdict, colors }) => {
  const box = (ok?: boolean) => ({ borderWidth: 1, borderColor: ok === undefined ? colors.border : ok ? good : colors.error, borderRadius: 8, padding: 10, color: colors.text, marginTop: 6 });
  const choose = (label: string, on: boolean, press: () => void, key: string) => (
    <TouchableOpacity key={key} onPress={press} style={{ borderWidth: 1, borderColor: on ? colors.primary : colors.border, borderRadius: 8, padding: 10, marginTop: 6 }}>
      <Text style={{ color: colors.text }}>{label}</Text>
    </TouchableOpacity>
  );
  switch (ex.kind) {
    case 'mcq': return <View>{ex.choices.map((c, i) => choose(c, value === i, () => onChange(i), String(i)))}</View>;
    case 'truefalse': return <View>{[true, false].map((b) => choose(b ? 'True' : 'False', value === b, () => onChange(b), String(b)))}</View>;
    case 'fill': case 'calc': case 'short':
      return <TextInput testID="practice-input" value={value ?? ''} onChangeText={onChange} multiline={ex.kind === 'short'} placeholder={ex.kind === 'calc' ? `Number${ex.unit ? ` (${ex.unit})` : ''}` : 'Your answer'} placeholderTextColor={colors.textMuted} keyboardType={ex.kind === 'calc' ? 'numeric' : 'default'} style={box(verdict?.correct)} />;
    case 'order': {
      const picked: string[] = value ?? [];
      const rest = useMemo(() => [...ex.items].sort(), [ex]);
      return <View>
        <Text style={{ color: colors.textSecondary, marginTop: 6 }}>Tap in the right order. Tap a chosen item to remove it.</Text>
        {picked.map((p, i) => choose(`${i + 1}. ${p}`, true, () => onChange(picked.filter((_, k) => k !== i)), `p${i}`))}
        {rest.filter((r) => !picked.includes(r)).map((r) => choose(r, false, () => onChange([...picked, r]), r))}
      </View>;
    }
    case 'match': {
      const got: Record<string, string> = value ?? {};
      const defs = ex.pairs.map((p) => p[1]).sort();
      return <View>{ex.pairs.map(([k], i) => (
        <View key={k} style={{ marginTop: 8 }}>
          <Text style={{ color: verdict?.parts ? (verdict.parts[i] ? good : colors.error) : colors.text }}>{k}</Text>
          {defs.map((d) => choose(d, got[k] === d, () => onChange({ ...got, [k]: d }), `${k}-${d}`))}
        </View>))}</View>;
    }
    case 'table': {
      const rows: Array<{ account?: string; amount?: string }> = value ?? [];
      const set = (i: number, patch: object) => onChange(ex.rows.map((_, k) => (k === i ? { ...rows[k], ...patch } : rows[k] ?? {})));
      return <View>{ex.rows.map((row: TableRow, i) => (
        <View key={i} style={{ marginTop: 10 }}>
          <Text style={{ color: verdict?.parts ? (verdict.parts[i] ? good : colors.error) : colors.text }}>{row.label}</Text>
          {row.options?.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{row.options.map((o) => (
            <TouchableOpacity key={o} onPress={() => set(i, { account: o })} style={{ borderWidth: 1, borderColor: rows[i]?.account === o ? colors.primary : colors.border, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, margin: 3 }}>
              <Text style={{ color: colors.text, fontSize: 13 }}>{o}</Text></TouchableOpacity>))}</View> : null}
          <TextInput value={rows[i]?.amount ?? ''} onChangeText={(t) => set(i, { amount: t })} keyboardType="numeric" placeholder="Amount" placeholderTextColor={colors.textMuted} style={box(verdict?.parts?.[i])} />
        </View>))}</View>;
    }
    case 'testlet': {
      const parts: any[] = value ?? [];
      return <View><Text style={{ color: colors.text, marginTop: 6 }}>{ex.stem}</Text>{ex.items.map((it, i) => (
        <View key={it.id ?? i} style={{ marginTop: 12 }}>
          <Text style={{ color: verdict?.parts ? (verdict.parts[i] ? good : colors.error) : colors.text, fontWeight: '600' }}>{i + 1}. {it.prompt}</Text>
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
  void addSet;

  const make = async () => {
    setBusy(true); setNote('');
    try {
      const r = await generatePractice(projectId, topic);
      setNote(`${r.added} questions added${r.dropped ? `, ${r.dropped} skipped (${r.reasons.join(', ')})` : ''}.`);
      setQueue(practiceSet(Object.values(useExerciseStore.getState().exercises), useExerciseStore.getState().progress, { topic: topic.trim() || undefined }));
    } catch (e: any) { Alert.alert('Could not make questions', String(e?.message || e)); } finally { setBusy(false); }
  };
  const start = (t?: string) => { setVerdict(undefined); setQueue(practiceSet(all, progress, { topic: t })); if (!all.length) setNote('No questions yet. Make some from your documents.'); };
  const value = current ? progress[current.id]?.saved : undefined;
  const submit = () => { if (!current) return; const v = check(current, value); setVerdict(v); record(current.id, v.correct); };
  const next = () => { setVerdict(undefined); setQueue((q) => q.slice(1)); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={{ color: colors.text, fontSize: 18, marginLeft: 12 }}>Practice: {project?.name || ''}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        {!current ? (
          <View>
            <TextInput testID="practice-topic" value={topic} onChangeText={setTopic} placeholder="Topic or chapter (optional)" placeholderTextColor={colors.textMuted} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10, color: colors.text }} />
            <Button title={busy ? 'Writing questions...' : 'Make questions from my documents'} onPress={make} loading={busy} disabled={busy} testID="practice-make" style={{ marginTop: 10 }} />
            <Button title="Practise what I have (missed and due first)" variant="outline" onPress={() => start(topic.trim() || undefined)} testID="practice-start" style={{ marginTop: 8 }} />
            {!!note && <Text testID="practice-note" style={{ color: colors.textSecondary, marginTop: 10 }}>{note}</Text>}
            {scores.length > 0 && <View style={{ marginTop: 18 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>Score by topic (weakest first)</Text>
              {scores.map((s) => <TouchableOpacity key={s.topic} onPress={() => start(s.topic)} style={{ paddingVertical: 8 }}>
                <Text style={{ color: s.percent < 60 ? colors.error : colors.text }}>{s.topic}: {s.percent}% ({s.attempts} tries)</Text></TouchableOpacity>)}
            </View>}
          </View>
        ) : (
          <View>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>{queue.length} left{current.topic ? ` - ${current.topic}` : ''}</Text>
            <Text testID="practice-prompt" style={{ color: colors.text, fontSize: 17, marginTop: 6 }}>{current.kind === 'testlet' ? 'Answer all parts' : current.prompt}</Text>
            <Answer ex={current} value={value} onChange={(v) => saveDraft(current.id, v)} verdict={verdict} colors={colors} />
            {verdict && <View style={{ marginTop: 14 }}>
              <Text testID="practice-result" style={{ color: verdict.correct ? good : colors.error, fontWeight: '600' }}>{verdict.correct ? 'Correct' : 'Not quite'}{verdict.note ? ` - ${verdict.note}` : ''}</Text>
              {!!current.explain && <Text style={{ color: colors.textSecondary, marginTop: 4 }}>{current.explain}</Text>}
              {current.source && <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>Source: {current.source.doc}{current.source.page ? `, p. ${current.source.page}` : ''}{current.source.section ? `, ${current.source.section}` : ''}: "{current.source.quote}"</Text>}
            </View>}
            <Button title={verdict ? 'Next' : 'Check'} onPress={verdict ? next : submit} testID={verdict ? 'practice-next' : 'practice-check'} style={{ marginTop: 14 }} />
            <Button title="Stop" variant="ghost" onPress={() => { setQueue([]); setVerdict(undefined); }} style={{ marginTop: 6 }} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

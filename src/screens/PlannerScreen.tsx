import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { Button } from '../components/Button';
import { buildPlan, behind, todaysTarget, type PlanDay } from '../study/planner';
import { parseExamLines, usePlanStore } from '../study/planStore';

const st = StyleSheet.create({
  flex: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', padding: 12 }, title: { fontSize: 18, marginLeft: 12 }, content: { padding: 16, paddingBottom: 120 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 90 }, top8: { marginTop: 8 }, top14: { marginTop: 14 }, row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }, semi: { fontWeight: '600' }, gap: { marginLeft: 8 },
});
const toLine = (e: { name: string; date: string; topics: string[] }) => `${e.name} | ${e.date} | ${e.topics.join(', ')}`;

export const PlannerScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { exams, done, setExams, toggleDone } = usePlanStore();
  const [text, setText] = useState(exams.map(toLine).join('\n'));
  const [msg, setMsg] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const plan = useMemo<PlanDay[]>(() => {
    try { return buildPlan(exams.map((e) => ({ ...e, done })), today); } catch { return []; }
  }, [exams, done, today]);
  const late = useMemo(() => behind(plan, done, today), [plan, done, today]);

  const save = () => {
    const r = parseExamLines(text);
    if (r.errors.length) { setMsg(r.errors.join('\n')); return; }
    try { buildPlan(r.exams, today); } catch (e: any) { setMsg(String(e?.message ?? e)); return; }
    setExams(r.exams); setMsg(`Saved ${r.exams.length} exam${r.exams.length === 1 ? '' : 's'}, in the order you sit them.`);
  };

  return (
    <SafeAreaView style={[st.flex, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={[st.title, { color: colors.text }]}>Study plan</Text>
      </View>
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.textSecondary }}>One exam per line, in the order you will sit them:  Name | YYYY-MM-DD | topic, topic, topic</Text>
        <TextInput testID="plan-text" value={text} onChangeText={setText} multiline autoCapitalize="none" autoCorrect={false} placeholder={'REG | 2026-12-20 | Basis, Gains, Entities, Ethics'} placeholderTextColor={colors.textMuted} style={[st.input, st.top8, { borderColor: colors.border, color: colors.text }]} />
        <Button title="Save plan" onPress={save} testID="plan-save" style={st.top8} />
        {!!msg && <Text testID="plan-msg" style={[st.top8, { color: colors.textSecondary }]}>{msg}</Text>}
        {plan.length > 0 && (
          <View style={st.top14}>
            <Text testID="plan-today" style={[st.semi, { color: colors.text }]}>Today</Text>
            <Text style={{ color: colors.textSecondary }}>{todaysTarget(plan, today)}</Text>
            {late.length > 0 && <Text testID="plan-behind" style={[st.top8, { color: colors.error }]}>{late.length} topic{late.length === 1 ? '' : 's'} behind: {late.join(', ')}</Text>}
            <Text style={[st.semi, st.top14, { color: colors.text }]}>Topics (tap when finished)</Text>
            {exams.flatMap((e) => e.topics.map((t) => ({ exam: e.name, t }))).map(({ exam, t }) => (
              <TouchableOpacity key={`${exam}-${t}`} onPress={() => toggleDone(t)} style={st.row} accessibilityRole="checkbox" accessibilityState={{ checked: done.includes(t) }}>
                <Icon name={done.includes(t) ? 'check-square' : 'square'} size={20} color={done.includes(t) ? colors.primary : colors.textMuted} />
                <Text style={[st.gap, { color: colors.text }]}>{exam}: {t}</Text>
              </TouchableOpacity>
            ))}
            <Text style={[st.semi, st.top14, { color: colors.text }]}>Schedule</Text>
            {plan.map((p, i) => <Text key={i} style={{ color: colors.textSecondary }}>{p.date}  {p.exam}: {p.topics.join('; ')}</Text>)}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

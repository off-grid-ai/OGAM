import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { Button } from '../components/Button';
import { checkDraft, parseRubric, type CriterionResult } from '../study/rubric';

const st = StyleSheet.create({
  flex: { flex: 1 }, header: { flexDirection: 'row', alignItems: 'center', padding: 12 }, title: { fontSize: 18, marginLeft: 12 }, content: { padding: 16, paddingBottom: 120 },
  input: { borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 120, marginTop: 6 }, top10: { marginTop: 10 }, top14: { marginTop: 14 }, semi: { fontWeight: '600' },
});

export const RubricScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const [rubric, setRubric] = useState('');
  const [draft, setDraft] = useState('');
  const [results, setResults] = useState<CriterionResult[] | null>(null);
  const [error, setError] = useState('');
  const run = () => {
    const crit = parseRubric(rubric);
    if (!crit.length) { setError('No criteria found. Paste the rubric with one criterion per line.'); setResults(null); return; }
    setError(''); setResults(checkDraft(crit, draft));
  };
  const open = results?.filter((r) => !r.covered) ?? [];
  const box = [st.input, { borderColor: colors.border, color: colors.text }];
  return (
    <SafeAreaView style={[st.flex, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={st.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={22} color={colors.text} /></TouchableOpacity>
        <Text style={[st.title, { color: colors.text }]}>Rubric check</Text>
      </View>
      <ScrollView contentContainerStyle={st.content} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.textSecondary }}>Paste the assignment rubric, one criterion per line, then your draft. The check looks for each criterion's key words in your draft. It finds criteria you may have skipped; it cannot judge how well you wrote them.</Text>
        <Text style={[st.semi, st.top14, { color: colors.text }]}>Rubric</Text>
        <TextInput testID="rubric-text" value={rubric} onChangeText={setRubric} multiline style={box} placeholder="1. Explains the research design..." placeholderTextColor={colors.textMuted} />
        <Text style={[st.semi, st.top14, { color: colors.text }]}>Your draft</Text>
        <TextInput testID="draft-text" value={draft} onChangeText={setDraft} multiline style={box} placeholder="Paste your draft" placeholderTextColor={colors.textMuted} />
        <Button title="Check my draft" onPress={run} testID="rubric-run" style={st.top14} />
        {!!error && <Text testID="rubric-error" style={[st.top10, { color: colors.error }]}>{error}</Text>}
        {results && (
          <View style={st.top14}>
            <Text testID="rubric-summary" style={[st.semi, { color: open.length ? colors.error : '#16A34A' }]}>
              {open.length ? `${open.length} of ${results.length} criteria look unaddressed` : `All ${results.length} criteria are mentioned`}
            </Text>
            {results.map((r) => (
              <Text key={r.id} style={[st.top10, { color: r.covered ? colors.textSecondary : colors.error }]}>
                {r.covered ? 'Mentioned' : 'Not found'}: #{r.id} {r.text}{r.covered ? '' : ` (missing: ${r.missing.join(', ')})`}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

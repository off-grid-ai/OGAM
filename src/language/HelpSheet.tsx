import React, { useState } from 'react';
import { ActivityIndicator, Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { Button } from '../components/Button';
import { languageService } from './languageService';
import type { Exercise } from './lessons';

/** What the tutor is told about the exercise on screen (without giving the answer away in the prompt itself). */
export function exerciseContext(ex: Exercise | undefined, langName: string, tip: string): string {
  if (!ex) return `I am learning ${langName}.`;
  const what = ex.kind === 'match'
    ? `matching these ${langName} words to English: ${ex.pairs.map((p) => `${p.t} = ${p.en}`).join('; ')}`
    : `a "${ex.kind}" exercise about "${ex.item.en}" (in ${langName}: "${ex.item.t}")`;
  return `I am learning ${langName} and I am doing ${what}.${tip ? `\nThe lesson's rule: ${tip}` : ''}`;
}

/** Help button sheet: ask the AI tutor about the exercise in front of you. */
export function HelpSheet({ visible, onClose, context }: { visible: boolean; onClose: () => void; context: string }) {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = (question: string) => {
    setBusy(true); setAnswer(null);
    languageService.askTutor(question, context)
      .then(setAnswer)
      .catch((e) => setAnswer(`The tutor could not answer: ${String(e?.message || e)}`))
      .finally(() => setBusy(false));
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} testID="lesson-help-sheet">
          <View style={styles.head}>
            <Text style={styles.title}>Ask the tutor</Text>
            <TouchableOpacity onPress={onClose} accessibilityLabel="Close"><Icon name="x" size={20} color={colors.text} /></TouchableOpacity>
          </View>
          <View style={styles.quick}>
            {['Give me a hint', 'Why is that the answer?', 'Explain the grammar'].map((x) => (
              <TouchableOpacity key={x} style={styles.chip} onPress={() => ask(x)} disabled={busy}><Text style={styles.chipText}>{x}</Text></TouchableOpacity>
            ))}
          </View>
          <TextInput value={q} onChangeText={setQ} placeholder="Or type your question" placeholderTextColor={colors.textMuted} style={styles.input} multiline />
          <Button title="Ask" disabled={!q.trim() || busy} onPress={() => ask(q.trim())} />
          {busy && <ActivityIndicator color={colors.primary} />}
          {!!answer && <Text style={styles.answer} testID="lesson-help-answer">{answer}</Text>}
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  backdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: `${colors.background}99` },
  sheet: { backgroundColor: colors.surface, padding: SPACING.lg, gap: SPACING.md, borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '80%' as const },
  head: { flexDirection: 'row' as const, alignItems: 'center' as const },
  title: { ...TYPOGRAPHY.h3, flex: 1, color: colors.text },
  quick: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: SPACING.sm },
  chip: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs + 2, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  chipText: { ...TYPOGRAPHY.bodySmall, color: colors.text },
  input: { ...TYPOGRAPHY.body, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: SPACING.md, minHeight: 60 },
  answer: { ...TYPOGRAPHY.body, color: colors.text },
});

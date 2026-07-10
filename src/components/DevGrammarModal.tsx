import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Switch,
  ScrollView,
  Pressable,
} from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY, FONTS } from '../constants';
import { useDevInferenceStore } from '../stores/devInferenceStore';
import logger from '../utils/logger';

const STARTER_GRAMMAR = `root  ::= "TITLE: " line "\\nSUMMARY: " line "\\nACTIONS:\\n" acts
acts  ::= "none\\n" | item+
item  ::= "- " line "\\n"
line  ::= [^\\n]+`;

interface DevGrammarModalProps {
  visible: boolean;
  onClose: () => void;
}

/**
 * DEV-ONLY test harness: paste a GBNF grammar (plus optional temperature /
 * assistant prefill) and apply it to the next chat completion(s). Lets us test
 * grammar-constrained / prefill / temp=0 output on the real on-device model
 * without leaving the app. Only mounted behind `__DEV__`.
 */
export const DevGrammarModal: React.FC<DevGrammarModalProps> = ({ visible, onClose }) => {
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const store = useDevInferenceStore();

  // Local drafts so edits aren't live until Apply. Seed from the store on open.
  const [grammar, setGrammar] = useState('');
  const [temperature, setTemperature] = useState('');
  const [prefix, setPrefix] = useState('');
  const [maxWords, setMaxWords] = useState('');
  const [litertType, setLitertType] = useState<'json_schema' | 'lark' | 'regex'>('json_schema');
  const [litertConstraint, setLitertConstraint] = useState('');
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setGrammar(store.grammar);
    setTemperature(store.temperature != null ? String(store.temperature) : '');
    setPrefix(store.assistantPrefix);
    setMaxWords(store.maxWords != null ? String(store.maxWords) : '');
    setLitertType(store.litertConstraintType);
    setLitertConstraint(store.litertConstraintString);
    setEnabled(store.enabled);
    // Seed once per open; store fields are intentionally not deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const apply = () => {
    const t = temperature.trim();
    const parsedTemp = t.length > 0 ? Number(t) : NaN;
    const w = maxWords.trim();
    const parsedWords = w.length > 0 ? Math.round(Number(w)) : NaN;
    store.setGrammar(grammar);
    store.setTemperature(Number.isFinite(parsedTemp) ? parsedTemp : undefined);
    store.setAssistantPrefix(prefix);
    store.setMaxWords(Number.isFinite(parsedWords) && parsedWords > 0 ? parsedWords : undefined);
    store.setLitertConstraintType(litertType);
    store.setLitertConstraintString(litertConstraint);
    store.setLastError(undefined);
    store.setEnabled(enabled);
    logger.log(
      `[DevGrammar] ARMED enabled=${enabled} grammarLen=${grammar.trim().length} ` +
        `temp=${Number.isFinite(parsedTemp) ? parsedTemp : 'default'} prefill=${prefix ? JSON.stringify(prefix) : 'none'} ` +
        `maxWords=${Number.isFinite(parsedWords) && parsedWords > 0 ? parsedWords : 'none'}`,
    );
    onClose();
  };

  const clearAll = () => {
    store.clear();
    setGrammar('');
    setTemperature('');
    setPrefix('');
    setMaxWords('');
    setLitertType('json_schema');
    setLitertConstraint('');
    setEnabled(false);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.centerWrap} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Icon name="terminal" size={16} color={colors.primary} />
            <Text style={styles.title}>Grammar test harness</Text>
            <View style={styles.devBadge}><Text style={styles.devBadgeText}>DEV</Text></View>
            <View style={styles.flex} />
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon name="x" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>GBNF grammar</Text>
            <TextInput
              style={[styles.input, styles.grammarInput]}
              value={grammar}
              onChangeText={setGrammar}
              placeholder={STARTER_GRAMMAR}
              placeholderTextColor={colors.textMuted}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
            />
            <TouchableOpacity onPress={() => setGrammar(STARTER_GRAMMAR)}>
              <Text style={styles.starterLink}>Insert starter grammar</Text>
            </TouchableOpacity>

            <View style={styles.twoCol}>
              <View style={styles.col}>
                <Text style={styles.label}>Temperature</Text>
                <TextInput
                  style={styles.input}
                  value={temperature}
                  onChangeText={setTemperature}
                  placeholder="e.g. 0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>Max words</Text>
                <TextInput
                  style={styles.input}
                  value={maxWords}
                  onChangeText={setMaxWords}
                  placeholder="e.g. 80"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="number-pad"
                />
              </View>
            </View>

            <Text style={styles.label}>Assistant prefill</Text>
            <TextInput
              style={styles.input}
              value={prefix}
              onChangeText={setPrefix}
              placeholder="e.g. TITLE: "
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={styles.divider} />
            <Text style={styles.sectionLabel}>LiteRT constraint (LLGuidance)</Text>
            <Text style={styles.hint}>Used when a LiteRT model is active. Not GBNF - pick a format below.</Text>
            <View style={styles.typeRow}>
              {(['json_schema', 'lark', 'regex'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeChip, litertType === t && styles.typeChipOn]}
                  onPress={() => setLitertType(t)}
                >
                  <Text style={[styles.typeChipText, litertType === t && styles.typeChipTextOn]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.input, styles.grammarInput]}
              value={litertConstraint}
              onChangeText={setLitertConstraint}
              placeholder={litertType === 'json_schema' ? '{"type":"object","properties":{...}}' : litertType === 'regex' ? '(TITLE: .+\\n)+' : 'start: ...'}
              placeholderTextColor={colors.textMuted}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
            />

            <View style={styles.enableRow}>
              <View style={styles.flex}>
                <Text style={styles.enableLabel}>Enable override</Text>
                <Text style={styles.hint}>GBNF applies on llama.cpp; the LiteRT constraint applies on LiteRT. Tools off while a grammar is active.</Text>
              </View>
              <Switch
                value={enabled}
                onValueChange={(v) => { logger.log(`[DevGrammar] enable toggle -> ${v}`); setEnabled(v); }}
              />
            </View>

            {store.lastError ? (
              <Text style={styles.error}>Grammar error: {store.lastError}</Text>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={clearAll}>
              <Text style={styles.secondaryText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={apply}>
              <Text style={styles.primaryText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

DevGrammarModal.displayName = 'DevGrammarModal';

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  backdrop: { ...StyleSheetAbsolute, backgroundColor: 'rgba(0,0,0,0.5)' },
  centerWrap: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, padding: SPACING.lg },
  card: {
    width: '100%' as const,
    maxWidth: 460,
    maxHeight: '85%' as const,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: SPACING.lg,
    ...shadows.medium,
  },
  headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.sm, marginBottom: SPACING.md },
  title: { ...TYPOGRAPHY.h3, color: colors.text },
  devBadge: { backgroundColor: `${colors.primary}22`, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 1 },
  devBadgeText: { ...TYPOGRAPHY.labelSmall, color: colors.primary },
  flex: { flex: 1 },
  body: { flexGrow: 0 },
  label: { ...TYPOGRAPHY.label, color: colors.textSecondary, marginBottom: SPACING.xs, marginTop: SPACING.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    color: colors.text,
    backgroundColor: colors.background,
    ...TYPOGRAPHY.bodySmall,
  },
  grammarInput: { minHeight: 120, maxHeight: 220, fontFamily: FONTS.mono, textAlignVertical: 'top' as const },
  starterLink: { ...TYPOGRAPHY.meta, color: colors.primary, marginTop: SPACING.xs },
  twoCol: { flexDirection: 'row' as const, gap: SPACING.md },
  col: { flex: 1 },
  divider: { height: 1, backgroundColor: colors.border, marginTop: SPACING.lg, marginBottom: SPACING.xs },
  sectionLabel: { ...TYPOGRAPHY.label, color: colors.textSecondary, marginTop: SPACING.sm },
  typeRow: { flexDirection: 'row' as const, gap: SPACING.xs, marginTop: SPACING.sm, marginBottom: SPACING.xs },
  typeChip: { paddingHorizontal: SPACING.sm, paddingVertical: 5, borderRadius: 7, borderWidth: 1, borderColor: colors.border },
  typeChipOn: { backgroundColor: `${colors.primary}22`, borderColor: colors.primary },
  typeChipText: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  typeChipTextOn: { color: colors.primary },
  enableRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.md, marginTop: SPACING.md },
  enableLabel: { ...TYPOGRAPHY.body, color: colors.text },
  hint: { ...TYPOGRAPHY.meta, color: colors.textMuted, marginTop: 2 },
  error: { ...TYPOGRAPHY.bodySmall, color: colors.error, marginTop: SPACING.md },
  actions: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: SPACING.sm, marginTop: SPACING.lg },
  secondaryBtn: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  secondaryText: { ...TYPOGRAPHY.body, color: colors.textSecondary },
  primaryBtn: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderRadius: 8, backgroundColor: colors.primary },
  primaryText: { ...TYPOGRAPHY.body, color: colors.background },
});

const StyleSheetAbsolute = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };

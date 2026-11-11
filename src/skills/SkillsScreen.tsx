import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { Button } from '../components/Button';
import { parseSkill, type ParsedSkill } from './parseSkill';
import { useSkills } from './skillsStore';
import { pickSkill } from './importSkill';
import { SKILL_LIBRARY } from './library';

/**
 * Skills: reusable instructions in the open SKILL.md format (the one Claude and OpenClaw use). A skill is added after a preview;
 * Atlas then follows it when a message clearly fits its description, or when you type /skill-name. Scripts and files next to
 * SKILL.md are not run, and a skill that depends on programs (curl, python) will only get its instructions followed.
 */
export const SkillsScreen: React.FC = () => {
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const { skills, add, remove, setEnabled } = useSkills();
  const [pending, setPending] = useState<ParsedSkill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const preview = (read: () => Promise<ParsedSkill | null> | ParsedSkill) => {
    setError(null);
    Promise.resolve().then(read).then((s) => { if (s) setPending(s); }).catch((e) => setError(String(e?.message || e)));
  };
  const confirmRemove = (name: string) => Alert.alert('Remove this skill?', `/${name}`, [
    { text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => remove(name) },
  ]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} accessibilityLabel="Back"><Icon name="arrow-left" size={20} color={colors.text} /></TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Skills</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.meta, { color: colors.textMuted }]}>
          A skill is a set of instructions in a SKILL.md file, the same format Claude and OpenClaw use. Atlas follows a skill when your message clearly fits its description, or when you start a message with /skill-name. Scripts and other files next to SKILL.md are not run. Only add skills you trust: their text steers the AI.
        </Text>

        {skills.map((s) => (
          <View key={s.name} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} testID={`skill-${s.name}`}>
            <View style={styles.row}>
              <TouchableOpacity style={styles.grow} onPress={() => setOpen(open === s.name ? null : s.name)} accessibilityLabel={`Show ${s.name}`}>
                <Text style={[styles.name, { color: colors.text }]}>/{s.name}</Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={open === s.name ? undefined : 2}>{s.description}</Text>
              </TouchableOpacity>
              <Switch value={s.enabled} onValueChange={(on) => setEnabled(s.name, on)} testID={`skill-switch-${s.name}`} />
            </View>
            {!!s.needs.length && <Text style={[styles.warn, { color: colors.error }]}>Expects {s.needs.join(', ')}, which Atlas cannot run: only its instructions are followed.</Text>}
            {open === s.name && (
              <View>
                <Text style={[styles.body2, { color: colors.text, borderColor: colors.border }]} selectable>{s.body.slice(0, 3000)}{s.body.length > 3000 ? '\n...' : ''}</Text>
                <TouchableOpacity onPress={() => confirmRemove(s.name)} testID={`skill-remove-${s.name}`} accessibilityLabel={`Remove ${s.name}`}><Text style={{ color: colors.error }}>Remove this skill</Text></TouchableOpacity>
              </View>
            )}
          </View>
        ))}
        {!skills.length && <Text style={[styles.meta, { color: colors.textMuted }]} testID="skills-empty">No skills yet.</Text>}

        {!!pending && (
          <View style={[styles.card, { borderColor: colors.primary, backgroundColor: colors.surface }]} testID="skill-preview">
            <Text style={[styles.name, { color: colors.text }]}>Add /{pending.name}?</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{pending.description}</Text>
            {!!pending.needs.length && <Text style={[styles.warn, { color: colors.error }]}>Expects {pending.needs.join(', ')}, which Atlas cannot run.</Text>}
            <Text style={[styles.body2, { color: colors.text, borderColor: colors.border }]}>{pending.body.slice(0, 1200)}{pending.body.length > 1200 ? '\n...' : ''}</Text>
            <View style={styles.actions}>
              <Button title="Add skill" onPress={() => { add(pending); setPending(null); setPasted(''); }} testID="skill-add" />
              <Button title="Cancel" variant="ghost" onPress={() => setPending(null)} testID="skill-cancel" />
            </View>
          </View>
        )}
        {!!error && <Text style={[styles.warn, { color: colors.error }]} testID="skill-error">{error}</Text>}

        <Text style={[styles.name, { color: colors.text }]}>Skill library</Text>
        <Text style={[styles.meta, { color: colors.textMuted }]}>Ready-made skills that come with Atlas. Tap one to add it.</Text>
        {SKILL_LIBRARY.filter((l) => !skills.some((s) => s.name === l.name)).map((l) => (
          <TouchableOpacity key={l.name} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]} onPress={() => add(l)}
            testID={`library-skill-${l.name}`} accessibilityLabel={`Add the ${l.name} skill`}>
            <Text style={[styles.name, { color: colors.text }]}>/{l.name}</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>{l.description}</Text>
          </TouchableOpacity>
        ))}
        {SKILL_LIBRARY.every((l) => skills.some((s) => s.name === l.name)) && <Text style={[styles.meta, { color: colors.textMuted }]}>Every library skill is added.</Text>}

        <Text style={[styles.name, { color: colors.text }]}>Add a skill</Text>
        <Button title="Choose a SKILL.md or zip" onPress={() => preview(pickSkill)} testID="skill-choose" />
        <Text style={[styles.meta, { color: colors.textMuted }]}>Or paste the text of a SKILL.md:</Text>
        <TextInput value={pasted} onChangeText={setPasted} multiline placeholder={'---\nname: my-skill\ndescription: When to use it\n---\nWhat to do...'} placeholderTextColor={colors.textMuted}
          style={[styles.input, { color: colors.text, borderColor: colors.border }]} testID="skill-paste" autoCapitalize="none" />
        <Button title="Preview" variant="outline" disabled={!pasted.trim()} onPress={() => preview(() => parseSkill(pasted))} testID="skill-preview-button" />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  title: { fontSize: 22, fontWeight: '400' },
  body: { padding: 16, gap: 12, paddingBottom: 60 },
  meta: { fontSize: 13 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
  name: { fontSize: 16 },
  warn: { fontSize: 12 },
  body2: { fontSize: 12, borderTopWidth: 1, paddingTop: 8, marginVertical: 8 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 120, textAlignVertical: 'top', fontSize: 13 },
  actions: { flexDirection: 'row', gap: 8 },
});

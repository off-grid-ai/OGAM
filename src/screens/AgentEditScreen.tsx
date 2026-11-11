import React, { useState, useEffect } from 'react';
import { useWideLayout } from '../hooks/useWideLayout';
import {
  StyleSheet, View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { isPal, useAgentStore } from '../stores/agentStore';
import { useAppStore } from '../stores/appStore';
import { SliderSetting } from '../components/SliderSetting';
import { ModelChips } from '../components/ModelChips';
import { VoiceProfileChips } from '../components/VoiceProfileChips';
import { Switch } from 'react-native';

const PAL_PROFILE_FIELDS: Array<{ key: 'age' | 'occupation' | 'origin' | 'appearance'; label: string; placeholder: string }> = [
  { key: 'age', label: 'Age or generation', placeholder: 'e.g. 26, mid-30s' },
  { key: 'occupation', label: 'Occupation', placeholder: 'e.g. sports coach, chef' },
  { key: 'origin', label: 'Where they are from', placeholder: 'e.g. Texas, London, online friend' },
  { key: 'appearance', label: 'Appearance / other notes', placeholder: 'e.g. tall, dark hair, athletic' },
];

function buildAdvFields(adv: { custom: boolean; temperature: number; topP: number; maxTokens: number; repeatPenalty: number; contextLength: number; toolsCustom: boolean; tools: string[]; modelId: string; voiceProfileId: string }) {
  return {
    temperature: adv.custom ? adv.temperature : undefined,
    topP: adv.custom ? adv.topP : undefined,
    maxTokens: adv.custom ? adv.maxTokens : undefined,
    repeatPenalty: adv.custom ? adv.repeatPenalty : undefined,
    contextLength: adv.custom ? adv.contextLength : undefined,
    enabledTools: adv.toolsCustom ? adv.tools : undefined,
    modelId: adv.modelId || undefined,
    voiceProfileId: adv.voiceProfileId || undefined,
  };
}

function loadPalProfile(src?: { age?: string; occupation?: string; origin?: string; appearance?: string }) {
  return { age: src?.age ?? '', occupation: src?.occupation ?? '', origin: src?.origin ?? '', appearance: src?.appearance ?? '' };
}

function buildPalProfile(kind: string, p: Record<string, string>) {
  if (kind !== 'pal') return undefined;
  const r: Record<string, string | undefined> = {};
  for (const k of ['age', 'occupation', 'origin', 'appearance']) r[k] = p[k]?.trim() || undefined;
  return r as { age?: string; occupation?: string; origin?: string; appearance?: string };
}

function PalSection({ kind, profile, onChange, styles, colors }: { kind: string; profile: Record<string, string>; onChange: (p: any) => void; styles: any; colors: any }) {
  if (kind !== 'pal') return null;
  return <PalProfileFields profile={profile} onChange={onChange} styles={styles} colors={colors} />;
}

function PalProfileFields({ profile, onChange, styles, colors }: { profile: Record<string, string>; onChange: (p: any) => void; styles: any; colors: any }) {
  return (
    <>
      <Text style={styles.label}>Character profile</Text>
      <Text style={styles.hint}>Optional facts about this pal. Leave blank anything that is not relevant.</Text>
      {PAL_PROFILE_FIELDS.map(({ key, label, placeholder }) => (
        <View key={key}>
          <Text style={styles.hint}>{label}</Text>
          <TextInput style={styles.input} value={profile[key] ?? ''} onChangeText={(v) => onChange((p: any) => ({ ...p, [key]: v }))}
            placeholder={placeholder} placeholderTextColor={colors.textMuted} />
        </View>
      ))}
    </>
  );
}

const TOOL_CHOICES: { id: string; label: string }[] = [
  { id: 'search_knowledge_base', label: 'Search knowledge base' },
  { id: 'update_project_document', label: 'Update shared project documents' },
  { id: 'search_offline_library', label: 'Offline library (Kiwix)' },
  { id: 'web_search', label: 'Web search' },
  { id: 'read_url', label: 'Read web page' },
  { id: 'list_files', label: 'List files' },
  { id: 'read_file', label: 'Read files' },
  { id: 'write_file', label: 'Write / edit files (asks first)' },
  { id: 'create_web_page', label: 'Build web pages (asks first)' },
  { id: 'open_file', label: 'Open files in other apps' },
  { id: 'calendar_events', label: 'Read calendar' },
  { id: 'add_calendar_event', label: 'Add calendar events' },
  { id: 'draft_message', label: 'Draft texts and emails' },
  { id: 'schedule_task', label: 'Schedule tasks and reminders' },
  { id: 'remember', label: 'Remember things you tell it' },
  { id: 'my_location', label: 'My location (GPS) and saved places' },
  { id: 'calculator', label: 'Calculator' },
  { id: 'find_image', label: 'Find pictures online (Wikimedia Commons, with credit)' },
  { id: 'study_helpers', label: 'Study helpers (planner, rubric check, APA references)' },
  { id: 'science_data', label: 'Science look-ups (elements, molar mass, pH, constants)' },
  { id: 'study_math', label: 'Study maths (statistics, units, dates, interest)' },
  { id: 'get_current_datetime', label: 'Date and time' },
  { id: 'get_device_info', label: 'Device info' },
];
const fmtK = (v: number) => (v >= 1024 ? `${(v / 1024).toFixed(v % 1024 ? 1 : 0)}K` : String(v));
import { RootStackParamList } from '../navigation/types';
const literalStyles = StyleSheet.create({
  s1: { flex: 1 },
  s2: { padding: 6 },
  s3: { fontSize: 16 },
});


type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'AgentEdit'>;
type RouteProps = RouteProp<RootStackParamList, 'AgentEdit'>;

export const AgentEditScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const agentId = route.params?.agentId;
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const { colors } = useTheme();
  const wide = useWideLayout();
  const styles = useThemedStyles(createStyles);

  const { getAgent, createAgent, updateAgent, deleteAgent, setActiveAgent } = useAgentStore();
  const existingProject = agentId ? getAgent(agentId) : null;
  const [kind, setKind] = useState<'agent' | 'pal'>(existingProject ? (isPal(existingProject) ? 'pal' : 'agent') : (route.params?.kind ?? 'agent'));

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    systemPrompt: '',
  });
  const [palProfile, setPalProfile] = useState({ age: '', occupation: '', origin: '', appearance: '' });

  const g = useAppStore.getState().settings as any;
  const [adv, setAdv] = useState({
    custom: false,
    temperature: g?.temperature ?? 0.7,
    topP: g?.topP ?? 0.95,
    maxTokens: g?.maxTokens ?? 512,
    repeatPenalty: g?.repeatPenalty ?? 1.1,
    contextLength: g?.contextLength ?? 2048,
    toolsCustom: false,
    modelId: '',
    voiceProfileId: '',
    tools: (g?.enabledTools as string[]) ?? ['search_knowledge_base'],
  });

  useEffect(() => {
    if (existingProject) {
      const a: any = existingProject;
      const custom = ['temperature', 'topP', 'maxTokens', 'repeatPenalty', 'contextLength'].some((k) => typeof a[k] === 'number');
      setAdv((p) => ({
        ...p,
        custom,
        temperature: a.temperature ?? p.temperature,
        topP: a.topP ?? p.topP,
        maxTokens: a.maxTokens ?? p.maxTokens,
        repeatPenalty: a.repeatPenalty ?? p.repeatPenalty,
        contextLength: a.contextLength ?? p.contextLength,
        toolsCustom: Array.isArray(a.enabledTools),
        modelId: a.modelId ?? '',
        voiceProfileId: a.voiceProfileId ?? '',
        tools: a.enabledTools ?? p.tools,
      }));
    }
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps -- load once per agent, keep unsaved edits

  const advFields = () => buildAdvFields(adv);

  useEffect(() => {
    if (existingProject) {
      setFormData({
        name: existingProject.name,
        description: existingProject.description,
        systemPrompt: existingProject.systemPrompt,
      });
      setPalProfile(loadPalProfile(existingProject.palProfile));
    }
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps -- load once per agent, keep unsaved edits

  const handleSave = () => {
    if (!formData.name.trim()) {
      setAlertState(showAlert('Error', 'Please enter a name for the agent'));
      return;
    }

    if (!formData.systemPrompt.trim()) {
      setAlertState(showAlert('Error', 'Please enter a system prompt'));
      return;
    }
    const palProfileData = buildPalProfile(kind, palProfile);
    if (existingProject) {
      updateAgent(existingProject.id, {
        name: formData.name.trim(),
        description: formData.description.trim(),
        systemPrompt: formData.systemPrompt.trim(),
        kind,
        palProfile: palProfileData,
        ...advFields(),
      });
      if (useAgentStore.getState().activeAgentId === existingProject.id) setActiveAgent(existingProject.id);
    } else {
      const created = createAgent({
        name: formData.name.trim(),
        description: formData.description.trim(),
        systemPrompt: formData.systemPrompt.trim(),
        kind,
        palProfile: palProfileData,
        ...advFields(),
      });
      setActiveAgent(created.id);
    }

    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {`${existingProject ? 'Edit' : 'New'} ${kind === 'pal' ? 'pal' : 'agent'}`}
          </Text>
          <TouchableOpacity onPress={handleSave} style={styles.headerButton}>
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={[styles.contentContainer, wide.column]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>Type</Text>
          <View style={styles.kindRow}>
            {([['agent', 'Agent', 'Gets work done: tools, study, writing'], ['pal', 'Pal', 'A character to talk or role-play with']] as const).map(([k, name, hint]) => (
              <TouchableOpacity key={k} testID={`agent-kind-${k}`} accessibilityRole="button" accessibilityState={{ selected: kind === k }} onPress={() => setKind(k)} style={[styles.kindCard, kind === k && styles.kindCardOn]}>
                <Text style={styles.kindName}>{name}</Text>
                <Text style={styles.kindHint}>{hint}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Name */}
          <Text style={styles.label}>Name *</Text>
          <TextInput
            style={styles.input}
            value={formData.name}
            onChangeText={(text) => setFormData({ ...formData, name: text })}
            placeholder="e.g., Atlas Medic, Survival Guide, Tutor"
            placeholderTextColor={colors.textMuted}
          />

          {/* Description */}
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={styles.input}
            value={formData.description}
            onChangeText={(text) => setFormData({ ...formData, description: text })}
            placeholder="What this agent is for"
            placeholderTextColor={colors.textMuted}
          />

          {/* Pal profile fields */}
          <PalSection kind={kind} profile={palProfile} onChange={setPalProfile} styles={styles} colors={colors} />

          {/* System Prompt */}
          <Text style={styles.label}>System Prompt *</Text>
          <Text style={styles.hint}>
            These instructions are sent to the AI at the start of every chat while this agent is active.
          </Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={formData.systemPrompt}
            onChangeText={(text) => setFormData({ ...formData, systemPrompt: text })}
            placeholder="Enter the instructions or context for the AI..."
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
          />

          <Text style={styles.tip}>
            Tip: Be specific about what you want the AI to do, how it should respond, and any context it needs.
          </Text>

          {/* Preferred model */}
          <Text style={styles.label}>Model</Text>
          <Text style={styles.hint}>Picking this agent switches to this model (loading takes a few seconds). "Current model" = don't switch.</Text>
          <ModelChips value={adv.modelId} onChange={(id) => setAdv((p) => ({ ...p, modelId: id }))} colors={colors} />

          {/* Voice used to read this agent's answers aloud */}
          <Text style={styles.label}>Voice</Text>
          <Text style={styles.hint}>Answers from this agent are read aloud in this voice profile. Make profiles in Models → Voice.</Text>
          <VoiceProfileChips value={adv.voiceProfileId} onChange={(id) => setAdv((p) => ({ ...p, voiceProfileId: id }))} colors={colors} />

          {/* Per-agent model settings */}
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.label}>Custom model settings</Text>
              <Text style={styles.hint}>Off = use the global settings from Settings → Model settings.</Text>
            </View>
            <Switch value={adv.custom} onValueChange={(v) => setAdv({ ...adv, custom: v })} />
          </View>
          {adv.custom && (
            <View>
              <SliderSetting label="Temperature" description="Lower = careful and consistent (good for medical). Higher = creative."
                value={adv.temperature} min={0} max={2} step={0.05} decimals={2}
                onChange={(v) => setAdv((p) => ({ ...p, temperature: v }))} />
              <SliderSetting label="Top P" description="Lower = sticks to the most likely words."
                value={adv.topP} min={0.05} max={1} step={0.05} decimals={2}
                onChange={(v) => setAdv((p) => ({ ...p, topP: v }))} />
              <SliderSetting label="Max tokens" description="Longest reply this agent may write."
                value={adv.maxTokens} min={64} max={8192} step={64} formatValue={fmtK}
                onChange={(v) => setAdv((p) => ({ ...p, maxTokens: v }))} />
              <SliderSetting label="Repeat penalty" description="Higher = repeats itself less."
                value={adv.repeatPenalty} min={1} max={2} step={0.05} decimals={2}
                onChange={(v) => setAdv((p) => ({ ...p, repeatPenalty: v }))} />
              <SliderSetting label="Context length" description="How much the agent can remember in one chat. Takes effect next time the model loads. More uses more memory."
                warning={adv.contextLength > 8192 ? 'High context uses a lot of RAM' : null}
                value={adv.contextLength} min={1024} max={32768} step={1024} formatValue={fmtK}
                onChange={(v) => setAdv((p) => ({ ...p, contextLength: v }))} />
            </View>
          )}

          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.label}>Custom tools</Text>
              <Text style={styles.hint}>Off = use the tools switched on in the chat's tools menu.</Text>
            </View>
            <Switch value={adv.toolsCustom} onValueChange={(v) => setAdv({ ...adv, toolsCustom: v })} />
          </View>
          {adv.toolsCustom && TOOL_CHOICES.map((t) => {
            const on = adv.tools.includes(t.id);
            return (
              <View key={t.id} style={styles.toolRow}>
                <Text style={styles.toolLabel}>{t.label}</Text>
                <Switch value={on} onValueChange={(v) => setAdv((p) => ({ ...p, tools: v ? [...p.tools, t.id] : p.tools.filter((x) => x !== t.id) }))} />
              </View>
            );
          })}

          {existingProject && (existingProject as any).memories?.length > 0 && (
            <View>
              <Text style={styles.label}>Remembered about you</Text>
              <Text style={styles.hint}>Stored only on this phone. Tap ✕ to forget one.</Text>
              {((existingProject as any).memories as string[]).map((m: string, i: number) => (
                <View key={`${i}-${m}`} style={styles.toolRow}>
                  <Text style={[styles.toolLabel, literalStyles.s1]}>{m}</Text>
                  <TouchableOpacity onPress={() => updateAgent(existingProject.id, { memories: ((existingProject as any).memories as string[]).filter((_: string, j: number) => j !== i) })} style={literalStyles.s2}>
                    <Text style={[{ color: colors.error }, literalStyles.s3]}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {existingProject && (
            <TouchableOpacity
              onPress={() => Alert.alert('Delete agent?', `${existingProject.name} and its lessons and memories will be removed.`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => { deleteAgent(existingProject.id); navigation.goBack(); } },
              ])}
              style={styles.deleteButton}
            >
              <Text style={[styles.cancelText, { color: colors.error }]}>Delete agent</Text>
            </TouchableOpacity>
          )}

          <View style={styles.bottomPadding} />
        </ScrollView>
      </KeyboardAvoidingView>
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  kindRow: { flexDirection: 'row' as const, gap: SPACING.sm },
  kindCard: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: SPACING.md },
  kindCardOn: { borderColor: colors.primary, backgroundColor: colors.surface },
  kindName: { ...TYPOGRAPHY.body, color: colors.text, fontWeight: '600' as const },
  kindHint: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary, marginTop: 2 },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
  },
  headerButton: {
    padding: SPACING.xs,
  },
  cancelText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
  },
  headerTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    fontWeight: '600' as const,
  },
  saveText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
    fontWeight: '400' as const,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: SPACING.lg,
    paddingBottom: 100,
  },
  label: {
    ...TYPOGRAPHY.label,
    color: colors.text,
    marginBottom: SPACING.sm,
    marginTop: SPACING.lg,
    textTransform: 'uppercase' as const,
  },
  hint: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginBottom: SPACING.sm,
  },
  input: {
    ...TYPOGRAPHY.body,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: SPACING.md,
    color: colors.text,
  },
  textArea: {
    minHeight: 180,
    maxHeight: 280,
    textAlignVertical: 'top' as const,
  },
  tip: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginTop: SPACING.md,
    lineHeight: 18,
  },
  switchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, marginTop: SPACING.md },
  switchText: { flex: 1, paddingRight: SPACING.md },
  toolRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingVertical: 6 },
  toolLabel: { ...TYPOGRAPHY.body, color: colors.text },
  deleteButton: {
    marginTop: SPACING.xl,
    padding: SPACING.md,
    alignItems: 'center' as const,
  },
  bottomPadding: {
    height: SPACING.xxl,
  },
});

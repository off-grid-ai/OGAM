import React, { useState, useEffect } from 'react';
import {
  StyleSheet, View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  KeyboardAvoidingView,
  Platform,
  InteractionManager,
  Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AttachStep, useSpotlightTour } from 'react-native-spotlight-tour';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { consumePendingSpotlight } from '../components/onboarding/spotlightState';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useProjectStore } from '../stores';
import { RootStackParamList } from '../navigation/types';
import { ProjectPinGate } from '../components/ProjectPinGate';
import { protectProject, permanentlyUnprotectProject } from '../stores/protectedProjectStorage';
import { PROJECT_TYPES, isStarterInstructions, projectType, type ProjectKind } from '../projects/projectTypes';
const BACKGROUNDCOLOR_RGBA_0_0_0_0_5 = 'rgba(0,0,0,0.5)';
const COLOR_FFF = '#fff';
const literalStyles = StyleSheet.create({
  s1: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  s2: { flex: 1, marginBottom: 0 },
  s3: { marginTop: 20, gap: 8 },
  s4: { padding: 13, borderRadius: 10 },
  s5: { borderWidth: 1 },
  s6: { fontWeight: '600' },
  s7: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: BACKGROUNDCOLOR_RGBA_0_0_0_0_5 },
  s8: { borderRadius: 14, padding: 20, gap: 14 },
  s9: { fontSize: 18, fontWeight: '700' },
  s10: { padding: 12, borderRadius: 8 },
  s11: { padding: 13, borderRadius: 9 },
  s12: { color: COLOR_FFF, textAlign: 'center' },
  s13: { textAlign: 'center' },
});


type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'ProjectEdit'>;
type RouteProps = RouteProp<RootStackParamList, 'ProjectEdit'>;

export const ProjectEditScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const projectId = route.params?.projectId;
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const [protectAction, setProtectAction] = useState<'protect' | 'unprotect' | null>(null);
  const [protectPin, setProtectPin] = useState('');
  const [protectPin2, setProtectPin2] = useState('');
  const [protectBusy, setProtectBusy] = useState(false);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const { goTo } = useSpotlightTour();
  const { getProject, createProject, updateProject } = useProjectStore();
  const existingProject = projectId ? getProject(projectId) : null;

  // If user arrived here via onboarding spotlight flow, show name input spotlight
  useEffect(() => {
    const pending = consumePendingSpotlight();
    if (pending !== null) {
      const task = InteractionManager.runAfterInteractions(() => goTo(pending));
      return () => task.cancel();
    }
  }, []);

  const [kind, setKind] = useState<ProjectKind>('general');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    systemPrompt: '',
    allowLearningActivities: true,
  });

  useEffect(() => {
    if (existingProject) {
      setKind(existingProject.kind ?? 'general');
      setFormData({
        name: existingProject.name,
        description: existingProject.description,
        systemPrompt: existingProject.systemPrompt,
        allowLearningActivities: existingProject.allowLearningActivities !== false,
      });
    }
  }, [existingProject]);

  const applyProjectProtection = async () => {
    if (!existingProject || !protectAction || protectBusy) return;
    if (!/^[0-9]{4,12}$/.test(protectPin)) { Alert.alert('PIN', 'Enter 4–12 digits.'); return; }
    if (protectAction === 'protect' && protectPin !== protectPin2) { Alert.alert('PIN', 'The two PINs do not match.'); return; }
    setProtectBusy(true);
    try {
      if (protectAction === 'protect') await protectProject(existingProject.id, protectPin);
      else await permanentlyUnprotectProject(existingProject.id, protectPin);
      setProtectPin(''); setProtectPin2(''); setProtectAction(null);
    } catch (e: any) { Alert.alert('Project protection', String(e?.message || e)); }
    finally { setProtectBusy(false); }
  };

  const handleSave = () => {
    if (!formData.name.trim()) {
      setAlertState(showAlert('Error', 'Please enter a name for the project'));
      return;
    }

    if (existingProject) {
      updateProject(existingProject.id, {
        name: formData.name.trim(),
        description: formData.description.trim(),
        systemPrompt: formData.systemPrompt.trim(),
        allowLearningActivities: formData.allowLearningActivities,
        kind,
      });
    } else {
      createProject({
        name: formData.name.trim(),
        description: formData.description.trim(),
        systemPrompt: formData.systemPrompt.trim(),
        allowLearningActivities: formData.allowLearningActivities,
        kind,
      });
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
            {existingProject ? 'Edit Project' : 'New Project'}
          </Text>
          <TouchableOpacity onPress={handleSave} style={styles.headerButton}>
            <Text style={styles.saveText}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          {existingProject?.course !== 'language' && (
            <>
              <Text style={styles.label}>Type</Text>
              <View style={styles.typeRow}>
                {PROJECT_TYPES.map((t) => (
                  <TouchableOpacity key={t.id} testID={`project-type-${t.id}`} accessibilityRole="button" accessibilityState={{ selected: kind === t.id }}
                    onPress={() => {
                      setKind(t.id);
                      // Starting instructions follow the type, but never replace what the person wrote.
                      setFormData((f) => (isStarterInstructions(f.systemPrompt) ? { ...f, systemPrompt: t.instructions } : f));
                    }}
                    style={[styles.typeChip, kind === t.id && styles.typeChipOn]}>
                    <Icon name={t.icon} size={16} color={kind === t.id ? colors.background : colors.textSecondary} />
                    <Text style={kind === t.id ? styles.typeChipTextOn : styles.typeChipText}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.hint}>{projectType(kind).hint}</Text>
            </>
          )}
          <Text style={styles.label}>Name *</Text>
          <AttachStep index={8} fill>
            <TextInput
              style={styles.input}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              placeholder="e.g., Spanish Learning, Code Review"
              placeholderTextColor={colors.textMuted}
            />
          </AttachStep>

          {/* Description */}
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={styles.input}
            value={formData.description}
            onChangeText={(text) => setFormData({ ...formData, description: text })}
            placeholder="Brief description of this project"
            placeholderTextColor={colors.textMuted}
          />

          {/* System Prompt */}
          <Text style={styles.label}>Project notes (optional)</Text>
          <Text style={styles.hint}>
            Extra context for chats in this project. It is added under the active agent's instructions. Who answers and how is set in Agents.
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

          <Text style={styles.label}>Learning activities</Text>
          <Text style={styles.hint}>Allow Atlas to suggest learning games, quizzes or podcasts based on this project's material. On by default; turn it off for writing-only projects. Offline arcade games are in Emergency mode.</Text>
          <View style={literalStyles.s1}>
            <Text style={[styles.label, literalStyles.s2]}>Allow project-based learning activities</Text>
            <Switch value={formData.allowLearningActivities} onValueChange={value => setFormData(current => ({ ...current, allowLearningActivities: value }))} />
          </View>

          {existingProject && <View style={literalStyles.s3}>
            <Text style={styles.label}>Project encryption</Text>
            <Text style={styles.hint}>Opt-in only. Encrypts this project's settings, notes and documents (text and search index) with its own Android Keystore key and your PIN. Chats and saved study results stay outside the lock, so a project with chats or saved study results cannot be protected, and Study, research and chats are off for protected projects.</Text>
            <TouchableOpacity onPress={() => { setProtectAction(existingProject.pinVerifier ? 'unprotect' : 'protect'); setProtectPin(''); }} style={[literalStyles.s4, { backgroundColor: colors.surface }, literalStyles.s5, { borderColor: colors.border }]}>
              <Text style={[{ color: colors.text }, literalStyles.s6]}>{existingProject.pinVerifier ? 'Permanently remove project protection' : 'Encrypt project settings with a PIN'}</Text>
            </TouchableOpacity>
          </View>}

          <View style={styles.bottomPadding} />
        </ScrollView>
      </KeyboardAvoidingView>
      {!!projectId && <ProjectPinGate projectId={projectId} />}
      <Modal visible={protectAction !== null} animationType="fade" transparent onRequestClose={() => setProtectAction(null)}>
        <View style={literalStyles.s7}>
          <View style={[{ backgroundColor: colors.surface }, literalStyles.s8]}>
            <Text style={[{ color: colors.text }, literalStyles.s9]}>{protectAction === 'protect' ? 'Protect project settings' : 'Permanently unprotect project'}</Text>
            <Text style={{ color: colors.textSecondary }}>{protectAction === 'protect' ? 'Choose a PIN; the same PIN may be used for other projects or chats.' : 'Enter the current PIN to decrypt and save these project settings normally.'}</Text>
            <TextInput value={protectPin} onChangeText={v => setProtectPin(v.replace(/\D/g,'').slice(0,12))} secureTextEntry keyboardType="number-pad" placeholder="4–12 digits" placeholderTextColor={colors.textMuted} style={[literalStyles.s5, { borderColor: colors.border }, literalStyles.s10, { color: colors.text }]} />
            {protectAction === 'protect' && <TextInput value={protectPin2} onChangeText={v => setProtectPin2(v.replace(/\D/g,'').slice(0,12))} secureTextEntry keyboardType="number-pad" placeholder="Type the PIN again" placeholderTextColor={colors.textMuted} style={[literalStyles.s5, { borderColor: colors.border }, literalStyles.s10, { color: colors.text }]} />}
            <TouchableOpacity disabled={protectBusy} onPress={applyProjectProtection} style={[literalStyles.s11, { backgroundColor: colors.primary }]}><Text style={literalStyles.s12}>{protectBusy ? 'Working…' : 'Confirm'}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { setProtectAction(null); setProtectPin(''); setProtectPin2(''); }}><Text style={[{ color: colors.text }, literalStyles.s13]}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  typeRow: { flexDirection: 'row' as const, gap: SPACING.sm, marginBottom: SPACING.xs },
  typeChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: SPACING.xs,
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: 18, borderWidth: 1, borderColor: colors.border,
  },
  typeChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeChipText: { ...TYPOGRAPHY.bodySmall, color: colors.textSecondary },
  typeChipTextOn: { ...TYPOGRAPHY.bodySmall, color: colors.background },
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
    fontWeight: '400' as const,
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
  bottomPadding: {
    height: SPACING.xxl,
  },
});

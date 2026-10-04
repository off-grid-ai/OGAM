import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useWorkspaceContentProjection } from '../hooks/useApplicationProjection';
import {
  describeWorkspaceContentFailure,
  useWorkspaceContentCommands,
} from '../hooks/useWorkspaceContentCommands';
import { RootStackParamList } from '../navigation/types';

type NavigationProp = NativeStackNavigationProp<RootStackParamList, 'ProjectEdit'>;
type RouteProps = RouteProp<RootStackParamList, 'ProjectEdit'>;

export const ProjectEditScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const projectId = route.params?.projectId;
  const [alertState, setAlertState] = useState<AlertState>(initialAlertState);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  // Reads come from the Shared workspace-content projection, which is the one owner of project
  // truth. The form keeps no copy of it: a project edited on another device flows in through the
  // subscription, and the draft below is only the uncommitted text the person is typing.
  const workspaceContent = useWorkspaceContentProjection();
  const { execute } = useWorkspaceContentCommands();
  const existingProject = projectId
    ? workspaceContent.projects.find(p => p.id === projectId) ?? null
    : null;

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    systemPrompt: '',
  });

  // Local UI command state only: tracks whether a save dispatch is in flight so a second tap
  // (or re-render) cannot fire a duplicate save command. This is legitimate local UI state, not
  // a domain owner - the committed project still comes only from the workspace-content
  // projection above.
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (existingProject) {
      setFormData({
        name: existingProject.name,
        description: existingProject.description,
        systemPrompt: existingProject.systemPrompt,
      });
    }
  }, [existingProject]);

  const handleSave = async () => {
    // In-flight save guard: a second dispatch while one is already pending is ignored outright,
    // so a double-tap on Save (or a stray re-fire) cannot send a duplicate command.
    if (isSaving) {
      return;
    }

    if (!formData.name.trim()) {
      setAlertState(showAlert('Error', 'Please enter a name for the project'));
      return;
    }
    if (!formData.systemPrompt.trim()) {
      setAlertState(showAlert('Error', 'Please enter a system prompt'));
      return;
    }

    const fields = {
      name: formData.name.trim(),
      description: formData.description.trim(),
      systemPrompt: formData.systemPrompt.trim(),
    };

    // An edit updates the project the screen arrived on, addressed by its own id, so saving can
    // never fork a second project. Only a screen opened without one creates.
    let outcome;
    setIsSaving(true);
    try {
      outcome = await execute(
        existingProject
          ? { type: 'update_project', projectId: existingProject.id, patch: fields }
          : { type: 'create_project', ...fields },
      );
    } catch (error) {
      setAlertState(
        showAlert('Error', `Could not save the project. ${String(error)}`),
      );
      return;
    } finally {
      // Cleared on every path out of the try - success, handled failure, and thrown error alike -
      // so the guard above never gets stuck open after a completed dispatch.
      setIsSaving(false);
    }

    // Leaving the form is the confirmation that the change is durable, so only a committed
    // outcome navigates. A failure keeps the typed draft on screen for another attempt.
    if (!outcome.ok) {
      setAlertState(showAlert('Error', describeWorkspaceContentFailure(outcome.failure)));
      return;
    }

    navigation.goBack();
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']} testID="project-edit-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton} testID="project-edit-cancel">
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {existingProject ? 'Edit Project' : 'New Project'}
          </Text>
          <TouchableOpacity
            onPress={handleSave}
            disabled={isSaving}
            style={styles.headerButton}
            testID="project-edit-save"
          >
            <Text style={[styles.saveText, isSaving && styles.saveTextDisabled]}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          <Text style={styles.label}>Name *</Text>
            <TextInput
              style={styles.input}
              value={formData.name}
              onChangeText={(text) => setFormData({ ...formData, name: text })}
              placeholder="e.g., Spanish Learning, Code Review"
              placeholderTextColor={colors.textMuted}
              testID="project-edit-name"
            />

          {/* Description */}
          <Text style={styles.label}>Description</Text>
          <TextInput
            style={styles.input}
            value={formData.description}
            onChangeText={(text) => setFormData({ ...formData, description: text })}
            placeholder="Brief description of this project"
            placeholderTextColor={colors.textMuted}
            testID="project-edit-description"
          />

          {/* System Prompt */}
          <Text style={styles.label}>System Prompt *</Text>
          <Text style={styles.hint}>
            This context is sent to the AI at the start of every chat in this project.
          </Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={formData.systemPrompt}
            onChangeText={(text) => setFormData({ ...formData, systemPrompt: text })}
            placeholder="Enter the instructions or context for the AI..."
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            testID="project-edit-system-prompt"
          />

          <Text style={styles.tip}>
            Tip: Be specific about what you want the AI to do, how it should respond, and any context it needs.
          </Text>

          <View style={styles.bottomPadding} />
        </ScrollView>
      </KeyboardAvoidingView>
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
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
  saveTextDisabled: {
    color: colors.textMuted,
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

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { TouchableOpacity } from '../components/Touchable';
import { AliveScreen } from '../components/AliveScreen';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CustomAlert, showAlert, hideAlert, AlertState, initialAlertState } from '../components/CustomAlert';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useProjectStore } from '../stores';
import { PROJECT_DELETE_FALLBACK_REASON } from '../stores/projectDeleteOutcome';
import { Button } from '../components/Button';
import Icon from 'react-native-vector-icons/Feather';
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

  const { getProject, createProject, updateProject } = useProjectStore();
  const existingProject = projectId ? getProject(projectId) : null;
  const deleteProject = useProjectStore(state => state.deleteProject);
  const confirmDelete = () => {
    if (!projectId) return;
    setAlertState(
      showAlert(
        'Delete Project',
        `Delete "${existingProject?.name}"? This will not delete the chats associated with this project.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              const outcome = await deleteProject(projectId);
              if (outcome.ok) {
                // Back past the deleted project's own screen to the list.
                navigation.pop(2);
                return;
              }
              setAlertState(showAlert('Project Not Deleted', outcome.reason || PROJECT_DELETE_FALLBACK_REASON));
            },
          },
        ],
      ),
    );
  };


  const [formData, setFormData] = useState({
    name: '',
    description: '',
    systemPrompt: '',
  });

  useEffect(() => {
    if (existingProject) {
      setFormData({
        name: existingProject.name,
        description: existingProject.description,
        systemPrompt: existingProject.systemPrompt,
      });
    }
  }, [existingProject]);

  const handleSave = () => {
    if (!formData.name.trim()) {
      setAlertState(showAlert('Error', 'Please enter a name for the project'));
      return;
    }
    if (!formData.systemPrompt.trim()) {
      setAlertState(showAlert('Error', 'Please enter a system prompt'));
      return;
    }

    if (existingProject) {
      updateProject(existingProject.id, {
        name: formData.name.trim(),
        description: formData.description.trim(),
        systemPrompt: formData.systemPrompt.trim(),
      });
    } else {
      createProject({
        name: formData.name.trim(),
        description: formData.description.trim(),
        systemPrompt: formData.systemPrompt.trim(),
      });
    }

    navigation.goBack();
  };

  return (
    <AliveScreen style={styles.container} testID="project-edit-screen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardAvoid}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton} testID="project-edit-cancel" accessibilityRole="button">
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {existingProject ? 'Edit project' : 'New project'}
          </Text>
          <TouchableOpacity onPress={handleSave} style={styles.headerButton} testID="project-edit-save" accessibilityRole="button">
            <Text style={styles.saveText}>Save</Text>
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

          {/* Instructions: the same word the project page uses. */}
          <Text style={styles.label}>Instructions *</Text>
          <Text style={styles.hint}>
            Every chat in this project starts with these.
          </Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={formData.systemPrompt}
            onChangeText={(text) => setFormData({ ...formData, systemPrompt: text })}
            placeholder="How should chats here answer, and what should they know?"
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            testID="project-edit-system-prompt"
          />

          <Text style={styles.tip}>
            Say what it should do, how it should answer, and what it needs to know.
          </Text>

          {existingProject && (
            // Deleting lives here, behind Edit, not at the foot of the project where the tab bar sits
            // on every other screen (a tap meant for the tabs landed on it, hand test 20). It still asks.
            <Button
              title="Delete project"
              variant="ghost"
              size="small"
              onPress={confirmDelete}
              icon={<Icon name="trash-2" size={16} color={colors.textMuted} />}
              textStyle={{ color: colors.textSecondary }}
              style={styles.deleteButton}
              testID="project-edit-delete"
            />
          )}

          <View style={styles.bottomPadding} />
        </ScrollView>
      </KeyboardAvoidingView>
      <CustomAlert {...alertState} onClose={() => setAlertState(hideAlert())} />
    </AliveScreen>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
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
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.borderLight,
    zIndex: 1,
  },
  // Cancel and Save are 44pt targets.
  headerButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center' as const,
    paddingHorizontal: SPACING.xs,
  },
  cancelText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
  },
  headerTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
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
    padding: SPACING.xl,
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
  // Fields like the app's search and composer: the card surface with a hairline edge.
  input: {
    ...TYPOGRAPHY.body,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
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
  deleteButton: { alignSelf: 'flex-start' as const, marginTop: SPACING.xl },
  bottomPadding: {
    height: SPACING.xxl,
  },
});

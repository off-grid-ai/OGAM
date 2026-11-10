import React from 'react';
import { View, Text, TextInput } from 'react-native';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { useAppStore } from '../../stores';
import { APP_CONFIG, TYPOGRAPHY, SPACING } from '../../constants';

const createStyles = (colors: ThemeColors) => ({
  systemPromptContainer: {
    marginBottom: SPACING.md,
  },
  // A heading and a line under it, like every other setting on the tab (hand test 2026-11-07: the
  // box sat under a bare sentence with no name).
  settingLabel: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    marginBottom: SPACING.xs,
  },
  settingHelp: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    marginBottom: SPACING.md,
    lineHeight: 18,
  },
  textArea: {
    ...TYPOGRAPHY.bodySmall,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    padding: SPACING.md,
    color: colors.text,
    minHeight: 80,
    textAlignVertical: 'top' as const,
  },
});

export const SystemPromptSection: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { settings, updateSettings } = useAppStore();
  // Empty means chat uses the built-in prompt, so show that one as the placeholder rather than a
  // shorter stand-in that is never sent (hand test 31).
  const systemPrompt = settings?.systemPrompt?.trim() ? settings.systemPrompt : '';

  return (
    <View style={styles.systemPromptContainer}>
      <Text style={styles.settingLabel} accessibilityRole="header">
        Default instructions
      </Text>
      <Text style={styles.settingHelp}>
        What the model is told before every chat outside a project. Leave it empty to use the built-in prompt.
      </Text>
      <TextInput
        testID="default-system-prompt-input"
        accessibilityLabel="Default instructions"
        style={styles.textArea}
        value={systemPrompt}
        onChangeText={(text) => updateSettings({ systemPrompt: text.trim() ? text : '' })}
        multiline
        numberOfLines={4}
        placeholder={APP_CONFIG.defaultSystemPrompt}
        placeholderTextColor={colors.textMuted}
      />
    </View>
  );
};

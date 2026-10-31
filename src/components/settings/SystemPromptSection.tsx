import React from 'react';
import { View, Text, TextInput } from 'react-native';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { useAppStore } from '../../stores';
import { TYPOGRAPHY, SPACING } from '../../constants';

const createStyles = (colors: ThemeColors) => ({
  systemPromptContainer: {
    marginBottom: SPACING.md,
  },
  settingHelp: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
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
  const systemPrompt = settings?.systemPrompt ?? 'You are a helpful AI assistant.';

  return (
    <View style={styles.systemPromptContainer}>
      <Text style={styles.settingHelp}>
        Instructions given to the model before each conversation. Used when chatting without a project selected.
      </Text>
      <TextInput
        testID="default-system-prompt-input"
        accessibilityLabel="Default system prompt"
        style={styles.textArea}
        value={systemPrompt}
        onChangeText={(text) => updateSettings({ systemPrompt: text })}
        multiline
        numberOfLines={4}
        placeholder="Enter system prompt..."
        placeholderTextColor={colors.textMuted}
      />
    </View>
  );
};

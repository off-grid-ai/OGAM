import React from 'react';
import { View, Text, Linking, Platform } from 'react-native';
import { TouchableOpacity } from './Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from './AppSheet';
import { useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import { GITHUB_URL, rateOnStore } from '../utils/sharePrompt';
import { useAppStore } from '../stores/appStore';
import { Button } from './Button';

interface SharePromptSheetProps {
  visible: boolean;
  onClose: () => void;
}

export const SharePromptSheet: React.FC<SharePromptSheetProps> = ({ visible, onClose }) => {
  const styles = useThemedStyles(createStyles);
  const setEngaged = useAppStore(s => s.setHasEngagedSharePrompt);

  const handleEngage = (action: string | (() => void)) => {
    setEngaged(true);
    if (typeof action === 'string') Linking.openURL(action);
    else action();
    onClose();
  };

  const handleNeverShow = () => {
    setEngaged(true);
    onClose();
  };

  return (
    <AppSheet sheet="share-prompt" visible={visible} onClose={onClose} enableDynamicSizing title="Support Open-Source AI">
      <View style={styles.content}>
        <Text style={styles.message}>
          Off Grid AI is completely free, open-source, and private - your chats and files never leave your device. Help grow the movement for accessible, private AI by spreading the word.
        </Text>

        <TouchableOpacity style={styles.button} onPress={() => handleEngage(GITHUB_URL)}>
          <Icon name="star" size={18} color={styles.buttonText.color} />
          <Text style={styles.buttonText}>Star on GitHub</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={() => handleEngage(rateOnStore)}>
          <Icon name="star" size={18} color={styles.buttonText.color} />
          <Text style={styles.buttonText}>
            {Platform.OS === 'ios' ? 'Rate on the App Store' : 'Rate on Google Play'}
          </Text>
        </TouchableOpacity>

        <View style={styles.dismissActions}>
          <Button
            title="Maybe later"
            variant="ghost"
            size="small"
            onPress={onClose}
            style={styles.dismissButton}
            textStyle={styles.dismissText}
            testID="share-prompt-maybe-later"
          />
          <Button
            title="Don't show again"
            variant="ghost"
            size="small"
            onPress={handleNeverShow}
            style={styles.dismissButton}
            textStyle={styles.dismissText}
            testID="share-prompt-never-show"
          />
        </View>
      </View>
    </AppSheet>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  content: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
    alignItems: 'center' as const,
  },
  message: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: SPACING.lg,
  },
  button: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: SPACING.sm,
    width: '100%' as const,
    paddingVertical: SPACING.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginBottom: SPACING.sm,
  },
  buttonText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
  },
  dismissActions: {
    flexDirection: 'row' as const,
    gap: SPACING.sm,
    width: '100%' as const,
    marginTop: SPACING.sm,
  },
  dismissButton: {
    flex: 1,
    minHeight: 44,
  },
  dismissText: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
  },
});

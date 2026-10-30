import React, { useEffect } from 'react';
import {
  View,
  Text,
} from 'react-native';
import { TouchableOpacity } from './Touchable';
import { LoadingDots } from './LoadingDots';
import { AppSheet } from './AppSheet';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import { countErrorShown } from '../services/analytics/interactions';

// AlertState + its factories are pure and live in utils/alertState so non-UI code can build an
// alert state without importing this component (no-backward-layering-core). Re-exported here so
// existing `from '../components/CustomAlert'` importers are unchanged.
import { AlertButton } from '../utils/alertState';

export type { AlertButton };
export type { AlertState } from '../utils/alertState';
export { initialAlertState, showAlert, hideAlert } from '../utils/alertState';

export interface CustomAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons?: AlertButton[];
  onClose?: () => void;
  loading?: boolean;
  closeLabel?: string;
  prominentMessage?: boolean;
}

/** An alert that reports a failure. Only this yes/no leaves the device (as a count), never the words. */
const ERROR_TITLE = /\b(error|failed|fail|couldn.t|could not|can.t|cannot|unable)\b/i;

export const CustomAlert: React.FC<CustomAlertProps> = ({
  visible,
  title,
  message,
  buttons = [{ text: 'OK', style: 'default' }],
  onClose,
  loading = false,
  closeLabel = 'Done',
  prominentMessage = false,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const isError = ERROR_TITLE.test(title);
  useEffect(() => {
    // session_summary.errors_shown: `<screen>:alert`, counted on the device.
    if (visible && isError) countErrorShown('alert');
  }, [visible, isError]);

  const handleButtonPress = (button: AlertButton) => {
    button.onPress?.();
    onClose?.();
  };

  return (
    <AppSheet
      visible={visible}
      onClose={() => onClose?.()}
      enableDynamicSizing
      title={title}
      // A question with its own Cancel needs no header Done: it would read as a second answer.
      closeLabel={buttons.some(button => button.style === 'cancel') ? '' : closeLabel}
    >
      <View style={styles.content} testID="app-alert">
        {loading ? (
          <LoadingDots color={colors.primary} style={styles.loadingIndicator} />
        ) : null}
        {message ? <Text style={[styles.message, prominentMessage && styles.messageProminent]} testID="app-alert-message">{message}</Text> : null}
        <View style={styles.buttonContainer}>
          {buttons.map((button, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.button,
                button.style === 'destructive' && styles.destructiveButton,
              ]}
              accessibilityRole="button"
              accessibilityLabel={button.text}
              onPress={() => handleButtonPress(button)}
            >
              <Text
                style={[
                  styles.buttonText,
                  button.style === 'cancel' && styles.cancelButtonText,
                  button.style === 'destructive' && styles.destructiveButtonText,
                ]}
              >
                {button.text}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </AppSheet>
  );
};

// Hook for managing alert state

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  content: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xxl,
    alignItems: 'center' as const,
  },
  loadingIndicator: {
    marginBottom: SPACING.md,
  },
  message: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: SPACING.lg,
  },
  messageProminent: {
    ...TYPOGRAPHY.body,
    color: colors.text,
    lineHeight: 22,
  },
  buttonContainer: {
    flexDirection: 'row' as const,
    marginTop: SPACING.sm,
    width: '100%' as const,
    gap: SPACING.sm,
  },
  button: {
    flex: 1,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  buttonText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
  },
  cancelButtonText: {
    color: colors.textMuted,
  },
  destructiveButton: {
    borderColor: colors.error,
  },
  destructiveButtonText: {
    color: colors.error,
  },
});

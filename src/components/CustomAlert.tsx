import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { AppSheet } from './AppSheet';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';

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
      closeLabel={closeLabel}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.primary} style={styles.loadingIndicator} />
        ) : null}
        {message ? <Text style={[styles.message, prominentMessage && styles.messageProminent]}>{message}</Text> : null}
        <View style={styles.buttonContainer}>
          {buttons.map((button, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.button,
                button.style === 'destructive' && styles.destructiveButton,
              ]}
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

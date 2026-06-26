import React from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable } from 'react-native';
import { useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import type { AlertButton } from './CustomAlert';

export interface CenteredAlertProps {
  visible: boolean;
  title: string;
  message?: string;
  buttons?: AlertButton[];
  onClose?: () => void;
}

/**
 * A centered, on-brand alert dialog.
 *
 * Unlike CustomAlert — which is built on AppSheet and slides up from the bottom —
 * this renders a centered card inside a plain `fade` Modal. It has no custom
 * slide animation and is far less prone to the iOS "can't present a modal while
 * another is dismissing" conflict, so it's the right choice for a simple confirm
 * that is triggered from inside another modal/menu (e.g. the chat mode dropdown).
 *
 * Shares the AlertButton / showAlert / AlertState API with CustomAlert, so it's a
 * drop-in swap.
 */
export const CenteredAlert: React.FC<CenteredAlertProps> = ({
  visible,
  title,
  message,
  buttons = [{ text: 'OK', style: 'default' }],
  onClose,
}) => {
  const styles = useThemedStyles(createStyles);

  const handleButtonPress = (button: AlertButton) => {
    button.onPress?.();
    onClose?.();
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => onClose?.()}
    >
      {/* Tapping the backdrop dismisses, matching the dropdown/sheet behaviour. */}
      <Pressable style={styles.backdrop} onPress={() => onClose?.()}>
        {/* Stop propagation so taps on the card don't close it. */}
        <Pressable style={styles.card} onPress={() => {}}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <View style={styles.buttonRow}>
            {buttons.map((button, index) => (
              <TouchableOpacity
                key={index}
                style={[styles.button, button.style === 'destructive' && styles.destructiveButton]}
                onPress={() => handleButtonPress(button)}
                activeOpacity={0.7}
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
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: SPACING.xl,
  },
  card: {
    width: '100%' as const,
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.lg,
    ...shadows.large,
  },
  title: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    textAlign: 'center' as const,
    marginBottom: SPACING.sm,
  },
  message: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: SPACING.lg,
  },
  buttonRow: {
    flexDirection: 'row' as const,
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

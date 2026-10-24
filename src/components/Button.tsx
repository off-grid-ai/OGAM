import React from 'react';
import { TouchableOpacity, Text, ViewStyle, TextStyle } from 'react-native';
import type { AccessibilityRole, AccessibilityState } from 'react-native';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import { LoadingDots } from './LoadingDots';

/** Height of a rendered text line as a multiple of its font size, on both platforms. */
const LOADER_LINE_BOX = 1.4;

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'small' | 'medium' | 'large';
  /** Highlighted state for toggle buttons */
  active?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityState?: AccessibilityState;
  accessibilityRole?: AccessibilityRole;
}

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  active = false,
  disabled = false,
  loading = false,
  icon,
  style,
  textStyle,
  testID,
  accessibilityLabel,
  accessibilityState,
  accessibilityRole = 'button',
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const buttonStyles = [
    styles.button,
    styles[`button_${variant}`],
    styles[`button_${size}`],
    active && styles.button_active,
    disabled && styles.button_disabled,
    style,
  ];

  const textStyles = [
    styles.text,
    styles[`text_${variant}`],
    styles[`text_${size}`],
    active && styles.text_active,
    disabled && styles.text_disabled,
    textStyle,
  ];

  return (
    <TouchableOpacity
      style={buttonStyles}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={accessibilityState}
    >
      {loading ? (
        // The dots, not a ring spinner: a rotating ring on a button reads as a retry glyph, so
        // "Pair" and "Share" both looked like they had failed the moment they started working.
        <LoadingDots
          color={variant === 'primary' ? colors.primary : colors.textSecondary}
          style={styles[`loader_${size}`]}
        />
      ) : (
        <>
          {icon}
          {title ? <Text style={textStyles}>{title}</Text> : null}
        </>
      )}
    </TouchableOpacity>
  );
};

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  button: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: 8,
    gap: SPACING.sm,
  },
  button_primary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  button_secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  button_outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  button_ghost: {
    backgroundColor: 'transparent',
  },
  button_danger: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.error,
  },
  button_active: {
    borderColor: colors.primary,
  },
  button_small: {
    paddingVertical: 10,
    paddingHorizontal: SPACING.md,
  },
  button_medium: {
    paddingVertical: 14,
    paddingHorizontal: SPACING.lg,
  },
  button_large: {
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
  },
  button_disabled: {
    opacity: 0.4,
  },
  text: {
    ...TYPOGRAPHY.body,
    fontWeight: '400' as const,
  },
  text_primary: {
    color: colors.primary,
  },
  text_secondary: {
    color: colors.text,
  },
  text_outline: {
    color: colors.textSecondary,
  },
  text_ghost: {
    color: colors.textSecondary,
  },
  text_danger: {
    color: colors.error,
  },
  text_active: {
    color: colors.primary,
  },
  text_small: {
    fontSize: TYPOGRAPHY.h3.fontSize,
  },
  text_medium: {
    fontSize: TYPOGRAPHY.body.fontSize,
  },
  text_large: {
    fontSize: TYPOGRAPHY.h2.fontSize,
  },
  text_disabled: {
    color: colors.textDisabled,
  },
  // A 6pt row of dots is shorter than the label it replaces, so a button would shrink the
  // instant it started working. The loader claims the same line box as the text it stands in
  // for - same token font size, same 1.4 line-box ratio - so the button holds its height.
  loader_small: {
    minHeight: TYPOGRAPHY.h3.fontSize * LOADER_LINE_BOX,
  },
  loader_medium: {
    minHeight: TYPOGRAPHY.body.fontSize * LOADER_LINE_BOX,
  },
  loader_large: {
    minHeight: TYPOGRAPHY.h2.fontSize * LOADER_LINE_BOX,
  },
});

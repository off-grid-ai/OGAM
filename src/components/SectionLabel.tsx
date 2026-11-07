import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';

/**
 * The quiet uppercase label above a group (brand: labels are whispers). One component, so every
 * screen's groups read the same (hand test 65 found "COMMUNITY", "Tools" and "Hardware" side by side).
 */
export const SectionLabel: React.FC<{ title: string; testID?: string; style?: StyleProp<TextStyle> }> = ({ title, testID, style }) => {
  const styles = useThemedStyles(createStyles);
  return <Text style={[styles.label, style]} testID={testID} accessibilityRole="header">{title}</Text>;
};

const createStyles = (colors: ThemeColors) => ({
  label: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
    color: colors.textMuted,
    marginBottom: SPACING.sm,
    marginLeft: SPACING.xs,
  },
});

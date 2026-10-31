import React from 'react';
import { Text } from 'react-native';
import { TouchableOpacity } from './Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

interface AdvancedToggleProps {
  isExpanded: boolean;
  onPress: () => void;
  testID?: string;
}

const createStyles = (colors: ThemeColors, _shadows: ThemeShadows) => ({
  container: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: SPACING.md,
    marginTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: SPACING.xs,
  },
  label: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
});

export const AdvancedToggle: React.FC<AdvancedToggleProps> = ({ isExpanded, onPress, testID }) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.7}
      testID={testID}
    >
      <Text style={styles.label}>Advanced</Text>
      <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
    </TouchableOpacity>
  );
};

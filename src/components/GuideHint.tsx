import React, { useContext } from 'react';
import { Text } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { NavigationContext } from '@react-navigation/native';
import { AnimatedPressable } from './AnimatedPressable';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';

/**
 * Under an error: the info icon and one line that opens "What it does for you", where you can ask
 * how to fix it in your own words (Mac, 2026-11-18). Outside a navigator (the crash screen) there
 * is nowhere to go, so it shows nothing.
 */
export const GuideHint: React.FC<{ onOpen?: () => void; testID?: string }> = ({ onOpen, testID = 'guide-hint' }) => {
  const navigation = useContext(NavigationContext);
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  if (!navigation) return null;
  return (
    <AnimatedPressable
      onPress={() => {
        onOpen?.();
        navigation.navigate('Guide' as never);
      }}
      accessibilityRole="button"
      accessibilityLabel="Ask how to fix this"
      style={styles.row}
      testID={testID}
    >
      <Icon name="info" size={16} color={colors.primary} />
      <Text style={styles.text}>Not sure what to do? Ask how to fix it.</Text>
    </AnimatedPressable>
  );
};

const createStyles = (colors: ThemeColors) => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    minHeight: 44,
  },
  text: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.primary,
    flexShrink: 1,
  },
});

import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { useAppStore } from '../../stores';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors, ThemeShadows } from '../../theme';

const OPTIONS = [
  { mode: 'system' as const, icon: 'monitor' },
  { mode: 'light' as const, icon: 'sun' },
  { mode: 'dark' as const, icon: 'moon' },
];

export const AppearanceSelector: React.FC = () => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const themeMode = useAppStore(state => state.themeMode);
  const setThemeMode = useAppStore(state => state.setThemeMode);

  return (
    <View style={styles.row}>
      <Text style={styles.label}>Appearance</Text>
      <View style={styles.selector}>
        {OPTIONS.map(({ mode, icon }) => (
          <TouchableOpacity
            key={mode}
            testID={`theme-${mode}`}
            accessibilityRole="button"
            accessibilityLabel={`Use ${mode} appearance`}
            accessibilityState={{ selected: themeMode === mode }}
            style={[styles.option, themeMode === mode && styles.optionActive]}
            onPress={() => setThemeMode(mode)}
          >
            <Icon
              name={icon}
              size={16}
              color={themeMode === mode ? colors.background : colors.textMuted}
            />
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    ...shadows.small,
  },
  label: { ...TYPOGRAPHY.body, color: colors.text },
  selector: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    padding: 3,
    gap: 2,
  },
  option: {
    width: 34,
    height: 30,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: 6,
  },
  optionActive: { backgroundColor: colors.primary },
});

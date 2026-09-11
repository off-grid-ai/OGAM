import React, { useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from './AppSheet';
import { SPACING, TYPOGRAPHY } from '../constants';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';

interface SettingsOption {
  value: string;
  label: string;
}

interface SettingsOptionSelectProps {
  label: string;
  value: string;
  options: SettingsOption[];
  onChange: (value: string) => void;
  description?: string;
  testID?: string;
  disabled?: boolean;
}

/** One settings selector for chat settings and the Models screens. */
export const SettingsOptionSelect: React.FC<SettingsOptionSelectProps> = ({
  label, value, options, onChange, description, testID, disabled = false,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TouchableOpacity
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? value}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        style={[styles.trigger, disabled && styles.disabled]}
        onPress={() => setOpen(true)}
      >
        <Text style={styles.value}>{selected?.label ?? value}</Text>
        <Icon name="chevron-down" size={16} color={colors.textMuted} />
      </TouchableOpacity>
      {description ? <Text style={styles.description}>{description}</Text> : null}

      <AppSheet visible={open} onClose={() => setOpen(false)} title={`Select ${label}`} enableDynamicSizing>
        <ScrollView contentContainerStyle={styles.options} keyboardShouldPersistTaps="handled">
          {options.map((option) => {
            const active = option.value === value;
            return (
              <TouchableOpacity
                key={option.value}
                testID={testID ? `${testID}-${option.value}` : undefined}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.option, active && styles.optionActive]}
                onPress={() => { onChange(option.value); setOpen(false); }}
              >
                <Text style={[styles.optionText, active && styles.optionTextActive]}>{option.label}</Text>
                {active ? <Icon name="check" size={16} color={colors.primary} /> : null}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </AppSheet>
    </View>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: { gap: SPACING.xs as number, marginBottom: SPACING.md },
  label: { ...TYPOGRAPHY.label, color: colors.textMuted, textTransform: 'uppercase' as const },
  trigger: {
    minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: SPACING.md, flexDirection: 'row' as const,
    alignItems: 'center' as const, justifyContent: 'space-between' as const,
    backgroundColor: colors.surface,
    ...shadows.small,
  },
  value: { ...TYPOGRAPHY.body, color: colors.text, flex: 1 },
  description: { ...TYPOGRAPHY.meta, color: colors.textMuted },
  disabled: { opacity: 0.6 },
  options: { padding: SPACING.lg, paddingBottom: SPACING.xxl },
  option: {
    minHeight: 48, paddingHorizontal: SPACING.md, borderWidth: 1, borderColor: colors.border,
    borderRadius: 8, marginBottom: SPACING.sm, flexDirection: 'row' as const,
    alignItems: 'center' as const, justifyContent: 'space-between' as const,
    backgroundColor: colors.surface,
  },
  optionActive: { borderColor: colors.primary, backgroundColor: `${colors.primary}12` },
  optionText: { ...TYPOGRAPHY.body, color: colors.text },
  optionTextActive: { color: colors.primary },
});

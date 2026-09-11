import React, { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../AppSheet';
import { AnimatedPressable } from '../AnimatedPressable';
import { SPACING, TYPOGRAPHY } from '../../constants';
import { useTheme, useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import type { RemoteModelOption } from '../../types';

interface Props {
  label: string;
  value: string;
  displayValue: string | null;
  options: RemoteModelOption[];
  onChange: (modelId: string) => void;
  placeholder: string;
  testID: string;
  loading?: boolean;
  allowManualEntry?: boolean;
}

/** A server-owned model choice. Manual ID entry remains the fallback for standard APIs without kinds. */
export const RemoteModelField: React.FC<Props> = ({
  label,
  value,
  displayValue,
  options,
  onChange,
  placeholder,
  testID,
  loading = false,
  allowManualEntry = true,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {loading ? (
        <View style={styles.select} testID={`${testID}-loading`}>
          <Text style={[styles.value, styles.placeholder]}>...</Text>
        </View>
      ) : options.length > 0 ? (
        <>
          <AnimatedPressable
            testID={testID}
            style={styles.select}
            hapticType="selection"
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`${label}: ${displayValue ?? 'Choose a model'}`}
          >
            <Text
              style={[styles.value, !displayValue && styles.placeholder]}
              numberOfLines={1}
            >
              {displayValue ?? 'Choose a model'}
            </Text>
            <Icon name="chevron-right" size={16} color={colors.textMuted} />
          </AnimatedPressable>
          <AppSheet
            visible={open}
            onClose={() => setOpen(false)}
            title={label.toUpperCase()}
            enableDynamicSizing
          >
            <ScrollView contentContainerStyle={styles.options}>
              {options.map(option => {
                const active = option.id === value;
                return (
                  <AnimatedPressable
                    key={option.id}
                    testID={`${testID}-option-${option.id}`}
                    style={[styles.option, active && styles.optionActive]}
                    hapticType="selection"
                    onPress={() => {
                      onChange(option.id);
                      setOpen(false);
                    }}
                  >
                    <Text style={styles.optionName} numberOfLines={2}>
                      {option.name}
                    </Text>
                    {active ? (
                      <Icon name="check" size={16} color={colors.primary} />
                    ) : null}
                  </AnimatedPressable>
                );
              })}
            </ScrollView>
          </AppSheet>
        </>
      ) : allowManualEntry ? (
        <TextInput
          testID={testID}
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : (
        <View style={styles.select} testID={`${testID}-empty`}>
          <Text style={[styles.value, styles.placeholder]}>No installed models</Text>
        </View>
      )}
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  field: { gap: SPACING.xs as number },
  label: {
    ...TYPOGRAPHY.label,
    color: colors.textMuted,
    textTransform: 'uppercase' as const,
  },
  select: {
    minHeight: 44,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceLight,
  },
  value: { ...TYPOGRAPHY.body, color: colors.text, flex: 1 },
  placeholder: { color: colors.textMuted },
  input: {
    ...TYPOGRAPHY.body,
    minHeight: 44,
    color: colors.text,
    backgroundColor: colors.surfaceLight,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: SPACING.md,
  },
  options: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
    gap: SPACING.sm as number,
  },
  option: {
    minHeight: 44,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.md,
    padding: SPACING.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionActive: { borderColor: colors.primary },
  optionName: { ...TYPOGRAPHY.body, color: colors.text, flex: 1 },
});

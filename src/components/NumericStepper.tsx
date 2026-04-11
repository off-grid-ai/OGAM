import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';

interface NumericStepperProps {
  value: number;
  min: number;
  max: number;
  step: number;
  decimals?: number;
  onChange: (value: number) => void;
  formatValue?: (value: number) => string;
  testID?: string;
}

export const NumericStepper: React.FC<NumericStepperProps> = ({
  value,
  min,
  max,
  step,
  decimals = 0,
  onChange,
  formatValue,
  testID,
}) => {
  const { colors } = useTheme();

  const round = (v: number) => Math.round(v / step) * step;

  const decrement = () => {
    const next = round(value - step);
    if (next >= min) onChange(parseFloat(next.toFixed(decimals)));
  };

  const increment = () => {
    const next = round(value + step);
    if (next <= max) onChange(parseFloat(next.toFixed(decimals)));
  };

  const display = formatValue ? formatValue(value) : value.toFixed(decimals);
  const canDecrement = value > min;
  const canIncrement = value < max;

  return (
    <View style={styles.row}>
      <TouchableOpacity
        testID={testID ? `${testID}-decrement` : undefined}
        onPress={decrement}
        disabled={!canDecrement}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={[styles.button, { borderColor: colors.border, backgroundColor: colors.surface }, !canDecrement && styles.buttonDisabled]}
      >
        <Icon name="minus" size={14} color={canDecrement ? colors.text : colors.textMuted} />
      </TouchableOpacity>

      <Text testID={testID ? `${testID}-value` : undefined} style={[styles.value, { color: colors.primary, borderColor: colors.border, backgroundColor: colors.surfaceLight }]}>
        {display}
      </Text>

      <TouchableOpacity
        testID={testID ? `${testID}-increment` : undefined}
        onPress={increment}
        disabled={!canIncrement}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={[styles.button, { borderColor: colors.border, backgroundColor: colors.surface }, !canIncrement && styles.buttonDisabled]}
      >
        <Icon name="plus" size={14} color={canIncrement ? colors.text : colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  button: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonDisabled: {
    opacity: 0.35,
  },
  value: {
    ...TYPOGRAPHY.body,
    fontWeight: '400',
    minWidth: 72,
    textAlign: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
});

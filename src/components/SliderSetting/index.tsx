import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { useTheme } from '../../theme';
import { TYPOGRAPHY, SPACING } from '../../constants';

interface SliderSettingProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Decimal places for the committed value. Defaults to 2 when step < 1, else 0. */
  decimals?: number;
  /** Formats the value shown in the header. */
  formatValue?: (value: number) => string;
  description?: string;
  warning?: string | null;
  warningColor?: string;
  onChange: (value: number) => void;
  testID?: string;
}

/**
 * A single numeric setting control: a draggable slider for quick changes, with
 * a live value you can tap to type an exact number (clamped to min/max) for
 * precise adjustment. Shared across every generation/model/TTS settings screen
 * so they stay consistent.
 */
export const SliderSetting: React.FC<SliderSettingProps> = ({
  label,
  value,
  min,
  max,
  step,
  decimals,
  formatValue,
  description,
  warning,
  warningColor,
  onChange,
  testID,
}) => {
  const { colors } = useTheme();
  const dp = decimals ?? (step < 1 ? 2 : 0);

  // While dragging, track the value locally so the label updates live without
  // writing to the store on every gesture frame (commit happens on release).
  const [dragValue, setDragValue] = useState<number | null>(null);
  const shown = dragValue ?? value;

  // Tap-to-edit: tap the value to type an exact number.
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  // Slider drag snaps to the step grid; typed input keeps full precision (dp).
  const commitFromSlider = (v: number) => {
    const snapped = Math.round(v / step) * step;
    onChange(parseFloat(clamp(snapped).toFixed(dp)));
  };

  const startEdit = () => {
    setEditText(String(parseFloat(value.toFixed(dp))));
    setEditing(true);
  };

  const commitEdit = () => {
    const parsed = parseFloat(editText);
    if (!Number.isNaN(parsed)) {
      onChange(parseFloat(clamp(parsed).toFixed(dp)));
    }
    setEditing(false);
  };

  const display = formatValue ? formatValue(shown) : shown.toFixed(dp);

  return (
    <View style={styles.group}>
      <View style={styles.header}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        {editing ? (
          <TextInput
            testID={testID ? `${testID}-input` : undefined}
            style={[styles.value, { color: colors.primary, borderColor: colors.primary, backgroundColor: colors.surfaceLight }]}
            value={editText}
            onChangeText={setEditText}
            onSubmitEditing={commitEdit}
            onBlur={commitEdit}
            keyboardType={dp > 0 ? 'decimal-pad' : 'number-pad'}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
          />
        ) : (
          <TouchableOpacity
            testID={testID ? `${testID}-value-button` : undefined}
            onPress={startEdit}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text
              testID={testID ? `${testID}-value` : undefined}
              style={[styles.value, { color: colors.primary, borderColor: colors.border, backgroundColor: colors.surfaceLight }]}
            >
              {display}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {description ? (
        <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text>
      ) : null}
      {warning ? (
        <Text style={[styles.description, { color: warningColor ?? colors.error }]}>{warning}</Text>
      ) : null}

      <Slider
        testID={testID ? `${testID}-slider` : undefined}
        style={styles.slider}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={setDragValue}
        onSlidingComplete={(v) => {
          setDragValue(null);
          commitFromSlider(v);
        }}
        minimumTrackTintColor={colors.primary}
        maximumTrackTintColor={colors.surfaceLight}
        thumbTintColor={colors.primary}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  group: {
    marginBottom: SPACING.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  label: {
    ...TYPOGRAPHY.body,
    flexShrink: 1,
    marginRight: SPACING.sm,
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
  description: {
    ...TYPOGRAPHY.bodySmall,
    marginBottom: SPACING.md,
    lineHeight: 18,
  },
  slider: {
    width: '100%',
    height: 40,
  },
});

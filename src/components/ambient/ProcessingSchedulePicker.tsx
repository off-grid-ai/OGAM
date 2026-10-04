/**
 * Picks WHEN the deferred ("Later") queue drains. Night presets for the common cases, plus a ±15-min
 * stepper for any time. Controlled: owns no state, just reads a minute-of-day and reports changes.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../theme';
import type { ThemeColors } from '../../theme';
import {
  SCHEDULE_PRESETS,
  formatScheduleLabel,
  normalizeMinuteOfDay
} from '../../services/ambient/scheduleModel';

interface Props {
  minuteOfDay: number;
  onChange: (minuteOfDay: number) => void;
}

const STEP = 15;

export function ProcessingSchedulePicker({ minuteOfDay, onChange }: Props): React.ReactElement {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const value = normalizeMinuteOfDay(minuteOfDay);

  return (
    <View style={styles.wrap}>
      <Text style={styles.caption}>Process the queue at</Text>

      <View style={styles.stepper}>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={() => onChange(normalizeMinuteOfDay(value - STEP))}
          testID="ambient-schedule-earlier"
        >
          <Icon name="minus" size={18} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.time} testID="ambient-schedule-time">
          {formatScheduleLabel(value)}
        </Text>
        <TouchableOpacity
          style={styles.stepBtn}
          onPress={() => onChange(normalizeMinuteOfDay(value + STEP))}
          testID="ambient-schedule-later"
        >
          <Icon name="plus" size={18} color={colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.presets}>
        {SCHEDULE_PRESETS.map(p => {
          const on = value === p.minuteOfDay;
          return (
            <TouchableOpacity
              key={p.label}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => onChange(p.minuteOfDay)}
              testID={`ambient-schedule-preset-${p.minuteOfDay}`}
            >
              <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{p.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: { gap: 10 },
    caption: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      backgroundColor: colors.surface,
      paddingHorizontal: 6,
      paddingVertical: 6
    },
    stepBtn: {
      width: 40,
      height: 36,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background
    },
    time: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
      letterSpacing: 0.5
    },
    presets: { flexDirection: 'row', gap: 8 },
    chip: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 9,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface
    },
    chipOn: { borderColor: colors.primary, backgroundColor: colors.primary + '22' },
    chipLabel: { color: colors.textSecondary, fontSize: 12.5, fontWeight: '600' },
    chipLabelOn: { color: colors.primary, fontWeight: '700' }
  });

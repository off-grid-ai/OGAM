import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme } from '../../../theme';
import { AnimatedPressable } from '../../AnimatedPressable';
import type { Message } from '../../../types';

/** ‹ 2/3 › under a message that has versions (a retried answer, an edited question). Each version
 *  keeps the turns after it, so stepping to one brings its whole thread back. */
export const VersionSwitcher: React.FC<{
  message: Message;
  onSelect: (direction: -1 | 1) => void;
}> = ({ message, onSelect }) => {
  const { colors } = useTheme();
  const versions = message.threadVersions;
  if (!versions || versions.count <= 1) return null;
  const noun = message.role === 'user' ? 'question' : 'response';
  const step = (direction: -1 | 1, enabled: boolean, icon: string, label: string) => (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={!enabled}
      onPress={() => onSelect(direction)}
      testID={`version-${direction < 0 ? 'previous' : 'next'}`}
      style={[styles.step, !enabled && styles.stepDisabled]}
    >
      <Icon name={icon} size={14} color={colors.textMuted} />
    </AnimatedPressable>
  );
  return (
    <View
      accessibilityLabel={`Version ${versions.index + 1} of ${versions.count}`}
      style={[styles.row, message.role === 'user' ? styles.end : styles.start]}
    >
      {step(-1, versions.index > 0, 'chevron-left', `Previous ${noun}`)}
      <Text style={[styles.count, { color: colors.textMuted }]}>
        {versions.index + 1}/{versions.count}
      </Text>
      {step(1, versions.index < versions.count - 1, 'chevron-right', `Next ${noun}`)}
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  start: { alignSelf: 'flex-start' },
  end: { alignSelf: 'flex-end' },
  step: { padding: 6 },
  stepDisabled: { opacity: 0.35 },
  count: { fontSize: 11 },
});

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { TouchableOpacity } from '../Touchable';
import { useTheme } from '../../theme';
import { FONTS, SPACING, TYPOGRAPHY } from '../../constants';

type Props = {
  title: string;
  /** What the section is set to now, so a closed section still tells you something. */
  summary?: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  testID?: string;
};

/** One row per settings section: the name, its current values in Mono, a hairline under it. */
export const SettingsSectionHeader: React.FC<Props> = ({ title, summary, open, onToggle, testID }) => {
  const { colors } = useTheme();
  return (
    <TouchableOpacity
      style={[styles.row, { borderBottomColor: colors.border }]}
      onPress={onToggle}
      activeOpacity={0.7}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
    >
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {summary ? (
          <Text style={[styles.summary, { color: colors.textMuted }]} numberOfLines={1}>
            {summary}
          </Text>
        ) : null}
      </View>
      <Icon name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingVertical: SPACING.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, marginRight: SPACING.md },
  title: { ...TYPOGRAPHY.body },
  summary: { ...TYPOGRAPHY.meta, fontFamily: FONTS.mono, marginTop: 2 },
});

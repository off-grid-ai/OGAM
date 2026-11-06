import React from 'react';
import { Text } from 'react-native';
import { useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { FONTS, TYPOGRAPHY } from '../../constants';

/** What a quick-settings row reports: on, off or automatic, a count, or a count that needs a look. */
export type QuickBadgeTone = 'on' | 'off' | 'count' | 'warn';

const WARNING = '#F59E0B';

/** "ON" and "AUTO" read as words: "On", "Auto". Counts stay numbers. */
const asWord = (label: string | number): string =>
  typeof label === 'number' ? String(label) : label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();

/**
 * The value at the end of a quick-settings row, as plain text: a boxed uppercase Mono pill on every
 * row made the menu read as a form (screen review). "On" reads in ink, "Off" quiet, counts in Mono.
 */
export const QuickBadge: React.FC<{ tone: QuickBadgeTone; label: string | number; testID?: string }> = ({
  tone,
  label,
  testID,
}) => {
  const styles = useThemedStyles(createStyles);
  return (
    <Text testID={testID} style={[styles.text, styles[tone]]}>{asWord(label)}</Text>
  );
};

const createStyles = (colors: ThemeColors) => ({
  text: { ...TYPOGRAPHY.bodySmall, minWidth: 32, textAlign: 'right' as const },
  on: { color: colors.text },
  off: { color: colors.textMuted },
  count: { color: colors.textSecondary, fontFamily: FONTS.mono },
  warn: { color: WARNING, fontFamily: FONTS.mono },
});

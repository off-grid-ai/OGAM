import React from 'react';
import { Text, View } from 'react-native';
import { useThemedStyles } from '../../theme';
import type { ThemeColors } from '../../theme';
import { FONTS } from '../../constants';

/** What a quick-settings row reports: on, off or automatic, a count, or a count that needs a look. */
export type QuickBadgeTone = 'on' | 'off' | 'count' | 'warn';

const WARNING = '#F59E0B';

/**
 * The state at the end of a quick-settings row. One shape for every row; only "on" carries the emerald
 * accent (brand/DESIGN_PHILOSOPHY.md: a single accent for the active state, no multi-colour badges).
 */
export const QuickBadge: React.FC<{ tone: QuickBadgeTone; label: string | number; testID?: string }> = ({
  tone,
  label,
  testID,
}) => {
  const styles = useThemedStyles(createStyles);
  return (
    <View testID={testID} style={[styles.badge, styles[tone]]}>
      <Text style={[styles.text, styles[`${tone}Text`]]}>{label}</Text>
    </View>
  );
};

const createStyles = (colors: ThemeColors) => ({
  badge: {
    minWidth: 40,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center' as const,
  },
  text: { fontSize: 10, fontFamily: FONTS.mono, fontWeight: '500' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  on: { borderColor: colors.primary, backgroundColor: `${colors.primary}1F` },
  onText: { color: colors.primary },
  off: { borderColor: colors.border },
  offText: { color: colors.textMuted },
  count: { borderColor: colors.border },
  countText: { color: colors.textSecondary },
  warn: { borderColor: WARNING },
  warnText: { color: WARNING },
});

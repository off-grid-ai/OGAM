import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { SPACING } from '../constants';

/**
 * A list as one surface divided by hairlines (brand: ui-library/docs/direction/DESIGN_PHILOSOPHY.md §5).
 *
 * Lists used to be stacks of separate bordered, shadowed cards, one per row, which read as a pile of
 * boxes. The group owns the surface and the dividers; its rows are flat (see `listRowStyle`), so a
 * screen holds more of what matters and every list looks the same.
 */
export const ListGroup: React.FC<{
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}> = ({ children, style, testID }) => {
  const styles = useThemedStyles(createStyles);
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.group, style]} testID={testID}>
      {rows.map((row, index) => (
        <React.Fragment key={(row as { key?: React.Key }).key ?? index}>
          {index > 0 && <View style={styles.divider} />}
          {row}
        </React.Fragment>
      ))}
    </View>
  );
};

/** A row inside a ListGroup: flat, no box of its own. */
export const listRowStyle = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  paddingHorizontal: SPACING.md,
  paddingVertical: SPACING.md,
  backgroundColor: 'transparent',
};

const createStyles = (colors: ThemeColors) => ({
  // As desktop's surfaces: the field shows through, with a hairline edge and a faint top highlight.
  group: {
    backgroundColor: colors.surfaceGlass,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderLight,
    boxShadow: 'inset 0px 1px 0px rgba(255,255,255,0.06)',
    overflow: 'hidden' as const,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: SPACING.md,
    backgroundColor: colors.borderLight,
  },
});

/**
 * The same look for a virtualized list, whose rows cannot sit inside one wrapper: the first and last
 * rows round the group's corners, and `ListGroupSeparator` draws the hairline between rows.
 */
export function listGroupRowEnds(index: number, count: number): ViewStyle {
  return {
    ...(index === 0 ? { borderTopLeftRadius: 12, borderTopRightRadius: 12 } : {}),
    ...(index === count - 1 ? { borderBottomLeftRadius: 12, borderBottomRightRadius: 12 } : {}),
  };
}

export const ListGroupSeparator: React.FC = () => {
  const styles = useThemedStyles(createSeparatorStyles);
  return (
    <View style={styles.track}>
      <View style={styles.line} />
    </View>
  );
};

const createSeparatorStyles = (colors: ThemeColors) => ({
  track: { backgroundColor: colors.surfaceGlass },
  line: {
    height: StyleSheet.hairlineWidth,
    marginLeft: SPACING.md,
    backgroundColor: colors.borderLight,
  },
});

import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useThemedStyles } from '../theme';
import { cardSurface } from '../theme/surface';
import type { ThemeColors } from '../theme';
import { SPACING } from '../constants';

/**
 * A list as one surface divided by hairlines (brand/DESIGN_PHILOSOPHY.md).
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
  group: {
    ...cardSurface(colors),
    overflow: 'hidden' as const,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: SPACING.md,
    backgroundColor: colors.borderLight,
  },
});

/** A card (ModelCard) used as a row inside a group: the group owns the surface, so the card drops its own. */
export const GROUPED_CARD_ROW: ViewStyle = { borderRadius: 0, marginTop: 0, marginBottom: 0, borderWidth: 0, shadowOpacity: 0, elevation: 0 };

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
  // Inside the card already, so the card's own surface shows through.
  track: { backgroundColor: 'transparent' },
  line: {
    height: StyleSheet.hairlineWidth,
    marginLeft: SPACING.md,
    backgroundColor: colors.borderLight,
  },
});

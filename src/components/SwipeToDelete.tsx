import React, { forwardRef } from 'react';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import Icon from 'react-native-vector-icons/Feather';
import { TouchableOpacity } from './Touchable';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { RADIUS, SPACING } from '../constants';

/** The open/close handle of a row (a list closes the open row before another opens). */
export type SwipeRowHandle = Swipeable;

/**
 * A row you swipe left to delete: the one owner of that gesture and its trash button.
 *
 * Five screens each drew their own button, with margins left over from when every row was a
 * separate card with a gap under it, so the trash sat above the row and against the edge (Mac,
 * 2026-11-19). Here the button fills the row's height with an even inset on every side, and the
 * row slides inside its own bounds, so a swipe never runs past the list's edge or padding.
 */
export const SwipeToDelete = forwardRef<
  Swipeable,
  {
    children: React.ReactNode;
    onDelete: () => void;
    /** What the button deletes, read aloud: "Delete <label>". */
    label: string;
    enabled?: boolean;
    onSwipeableWillOpen?: () => void;
    testID?: string;
  }
>(({ children, onDelete, label, enabled = true, onSwipeableWillOpen, testID }, ref) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Swipeable
      ref={ref}
      enabled={enabled}
      onSwipeableWillOpen={onSwipeableWillOpen}
      renderRightActions={
        enabled
          ? () => (
              <TouchableOpacity
                style={styles.action}
                onPress={onDelete}
                testID={testID}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${label}`}
              >
                <Icon name="trash-2" size={16} color={colors.error} />
              </TouchableOpacity>
            )
          : undefined
      }
      overshootRight={false}
      containerStyle={styles.container}
    >
      {children}
    </Swipeable>
  );
});
SwipeToDelete.displayName = 'SwipeToDelete';

const createStyles = (colors: ThemeColors) => ({
  // The row slides within its own box: nothing shows past the list's edge while it moves.
  container: { overflow: 'hidden' as const },
  action: {
    backgroundColor: colors.errorBackground,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    alignSelf: 'stretch' as const,
    width: 44,
    borderRadius: RADIUS.md,
    margin: SPACING.xs,
    marginLeft: SPACING.sm,
  },
});

import React, { type ReactNode } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { SPACING, TYPOGRAPHY } from '../constants';

/** A small Button (10px padding + one text line) plus the header's own padding. */
const TAB_HEADER_MIN_HEIGHT = 56;
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';

interface ScreenHeaderProps {
  title: string;
  /** Omitted on a tab root, which has nothing to go back to (Settings). */
  onBack?: () => void;
  /** A status or action at the trailing edge, e.g. the Pro badge. */
  right?: ReactNode;
  testID?: string;
  variant?: 'screen' | 'tab';
}

/**
 * The one screen header.
 *
 * Its shape is not a new opinion: these are the tokens Settings and Model Settings already use, which
 * is what every other screen is measured against. They were copied per screen, so the copies drifted -
 * Sync lost the shadow and used a chevron in a 44px box, the Pro screen had no header at all - and
 * "make it match" meant editing each one. Now it means editing this.
 *
 * The touch target comes from hitSlop rather than padding, so the arrow can sit beside the title at
 * the standard inset while staying comfortably tappable.
 */
export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  onBack,
  right,
  testID,
  variant = 'screen',
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View
      style={[styles.header, variant === 'tab' && styles.tabHeader]}
      testID={testID}
    >
      {onBack ? (
        <TouchableOpacity
          style={styles.backButton}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
      ) : null}
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    minHeight: 60,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
  },
  // One height for every tab header. Without a floor the row took the height of whatever sat on
  // the right - a "New" button on Chats and Projects, nothing on Settings - so the same title read
  // as two different sizes across tabs.
  tabHeader: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minHeight: TAB_HEADER_MIN_HEIGHT,
  },
  backButton: { padding: SPACING.xs },
  title: { ...TYPOGRAPHY.h2, color: colors.text, flex: 1 },
});

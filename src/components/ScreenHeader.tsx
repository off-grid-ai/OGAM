import React, { type ReactNode } from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TouchableOpacity } from './Touchable';
import Icon from 'react-native-vector-icons/Feather';
import { FONTS, SPACING, TYPOGRAPHY } from '../constants';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';

/**
 * The fill of every bar that stays put at the top (header, tabs, search): the screen's own living
 * field, as the tabs always had. A white block over the header and search with the field showing
 * only in the tab strip between them read as three pieces (Mac, 2026-11-19: "just extend the
 * background that the tabs have"). The list sits below the bars, never behind them, so nothing
 * shows through.
 */
const HEADER_FILL = 'transparent';

/**
 * The header bar's surface: the shared top fill and no shadow, so the bars and the page read as one
 * continuous field (Mac, 2026-11-19: "we don't want any white of sorts"). Every screen's own header
 * bar uses this too.
 */
export const headerSurface = (_colors: ThemeColors, _shadows: ThemeShadows) => ({
  backgroundColor: HEADER_FILL,
});

/** Runs a header bar's background up under the status bar, so the two read as one surface. */
export const HeaderStatusFill: React.FC = () => {
  const { top } = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={[fillStyles.fill, { top: -top, height: top, backgroundColor: HEADER_FILL }]}
    />
  );
};

const fillStyles = StyleSheet.create({ fill: { position: 'absolute', left: 0, right: 0 } });

interface ScreenHeaderProps {
  title: string;
  /** Omitted on a tab root, which has nothing to go back to (Settings). */
  onBack?: () => void;
  /** A status or action at the trailing edge, e.g. the Pro badge. */
  right?: ReactNode;
  testID?: string;
  /** Kept for screens whose Back already had a test id before they moved to this header. */
  backTestID?: string;
  /** A second line under the title, e.g. a file's size. */
  subtitle?: string;
  variant?: 'screen' | 'tab';
  /** Makes the title a button, e.g. to rename what it names. */
  onTitlePress?: () => void;
  /** What tapping the title does, for a screen reader ("Rename"). */
  titleHint?: string;
  /**
   * Another fixed bar (tabs, search) sits right under the header. The bars are one surface, so the
   * edge and its shadow go under the last bar only, not between them.
   */
  barBelow?: boolean;
}

/**
 * The one screen header.
 *
 * Its shape is not a new opinion: these are the tokens Settings and Model Settings already use, which
 * is what every other screen is measured against. They were copied per screen, so the copies drifted -
 * Sync lost the shadow and used a chevron in a 44px box, the Pro screen had no header at all - and
 * "make it match" meant editing each one. Now it means editing this.
 *
 * The back target is a 44 pt frame pulled back by negative margins, so the arrow sits beside the
 * title at the standard inset while the frame a thumb and a screen reader measure stays 44 pt.
 */
export const ScreenHeader: React.FC<ScreenHeaderProps> = ({
  title,
  onBack,
  right,
  testID,
  backTestID,
  subtitle,
  variant = 'screen',
  onTitlePress,
  barBelow = false,
  titleHint,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const titleText = subtitle ? (
    <View style={styles.titleBlock}>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.subtitle} numberOfLines={1}>
        {subtitle}
      </Text>
    </View>
  ) : (
    <Text style={styles.title} numberOfLines={1}>
      {title}
    </Text>
  );

  return (
    <View
      style={[styles.header, variant === 'tab' && styles.tabHeader, barBelow && styles.joined]}
      testID={testID}
    >
      <HeaderStatusFill />
      {onBack ? (
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID={backTestID}
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
      ) : null}
      {onTitlePress ? (
        <TouchableOpacity
          style={styles.titleButton}
          onPress={onTitlePress}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityHint={titleHint}
          testID={testID ? `${testID}-title` : undefined}
        >
          {titleText}
        </TouchableOpacity>
      ) : (
        titleText
      )}
      {right}
    </View>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  // The header is a surface above the screen: its own background and a soft shadow for depth, a
  // hairline under it, and the screen's 24px gutter (brand Mobile profile).
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.md,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
    ...headerSurface(colors, shadows),
    zIndex: 1,
  },
  // The bar under it carries the edge.
  joined: { borderBottomWidth: 0, boxShadow: 'none' },
  tabHeader: {
    paddingVertical: SPACING.xs,
    minHeight: 52,
    borderBottomWidth: 0,
  },
  // A 44 pt frame pulled back 8 pt, so the arrow still sits beside the title and the header keeps
  // its height. A screen reader measures the frame, not hitSlop (hand test 44: 28 pt).
  backButton: { width: 44, height: 44, margin: -8, alignItems: 'center' as const, justifyContent: 'center' as const },
  title: { ...TYPOGRAPHY.h2, color: colors.text, flex: 1 },
  titleBlock: { flex: 1 },
  // A row, so the title's flex grows sideways, not down, and the text stays level with the back arrow.
  titleButton: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const },
  subtitle: { ...TYPOGRAPHY.meta, fontFamily: FONTS.mono, color: colors.textMuted },
});

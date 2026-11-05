import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { TouchableOpacity } from './Touchable';
import { useThemedStyles } from '../theme';
import type { ThemeColors } from '../theme';
import { SPACING, TYPOGRAPHY } from '../constants';
import { SCROLL_DEPTH_PROPS } from '../constants/scrollDepth';

export interface UnderlineTab<K extends string> {
  key: K;
  label: string;
  testID?: string;
}

/**
 * Tabs as words with a thin emerald line under the chosen one (desktop's tab strip). One look for
 * every tab row, so no screen draws its own filled pills.
 */
export function UnderlineTabs<K extends string>({ tabs, active, onChange }: Readonly<{
  tabs: readonly UnderlineTab<K>[];
  active: K;
  onChange: (key: K) => void;
}>) {
  const styles = useThemedStyles(createStyles);
  return (
    <ScrollView
      {...SCROLL_DEPTH_PROPS}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroller}
      contentContainerStyle={styles.bar}
    >
      {tabs.map(tab => (
        <TouchableOpacity
          key={tab.key}
          style={styles.item}
          testID={tab.testID}
          onPress={() => onChange(tab.key)}
          accessibilityRole="tab"
          accessibilityState={{ selected: active === tab.key }}
        >
          <Text style={[styles.text, active === tab.key && styles.textActive]}>{tab.label}</Text>
          {active === tab.key && <View style={styles.indicator} />}
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) => ({
  // Never squeezed by its screen, so the line under the tabs is the row's own bottom edge.
  scroller: {
    flexGrow: 0,
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 12,
  },
  bar: {
    flexDirection: 'row' as const,
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.sm,
    gap: SPACING.md,
  },
  // 44 pt tall: a tab is a target (it was 36).
  item: { minHeight: 44, justifyContent: 'center' as const, alignItems: 'center' as const },
  text: { ...TYPOGRAPHY.body, color: colors.textMuted },
  textActive: { color: colors.text, fontWeight: '500' as const },
  // Absolute, so the chosen tab's label sits level with the others in the 44 pt row.
  indicator: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    // On the line under the tabs, the same on every screen (hand test 44: 6 pt above it on Models).
    bottom: 0,
    height: 2,
    backgroundColor: colors.primary,
    borderRadius: 1,
  },
});

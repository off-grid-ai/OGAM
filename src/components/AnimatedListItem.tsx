import React from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { AnimatedEntry } from './AnimatedEntry';
import { AnimatedPressable, type AnimatedPressableProps } from './AnimatedPressable';
import { type HapticType } from '../utils/haptics';

export interface AnimatedListItemProps {
  /** List index for stagger delay */
  index: number;
  /** Stagger delay per item in ms (default 30) */
  staggerMs?: number;
  /** Max items to animate (default 10) */
  maxItems?: number;
  /** Change this value to replay the entry animation (e.g. pass a focus counter) */
  trigger?: number;
  /** Haptic type on press (default 'selection') */
  hapticType?: HapticType;
  /** Scale on press (default 0.97) */
  scaleValue?: number;
  /** Container style */
  style?: StyleProp<ViewStyle>;
  /** Press handler */
  onPress?: () => void;
  /** Long press handler */
  onLongPress?: () => void;
  /** Disabled state */
  disabled?: boolean;
  /** Test ID */
  testID?: string;
  /**
   * Accessibility label for the whole row. Without one, iOS concatenates every child into a single
   * run-on name - a projects row read as "O, Off Grid AI …, , 0, Known Off Grid AI source materi…"
   * - which is unusable to VoiceOver and leaves the row unaddressable by name.
   */
  accessibilityLabel?: string;
  /** What the row is, for assistive tech. List rows that navigate are buttons. */
  accessibilityRole?: AnimatedPressableProps['accessibilityRole'];
  /** Current checked, selected, or disabled state for assistive tech. */
  accessibilityState?: AnimatedPressableProps['accessibilityState'];
  /** Secondary detail (counts, description) that should not crowd the label. */
  accessibilityHint?: string;
  children: React.ReactNode;
}

/**
 * Combined animated list item: staggered entry animation + press feedback.
 * Use this for any tappable list item that should animate in on mount.
 */
export function AnimatedListItem({
  index,
  staggerMs = 30,
  maxItems = 10,
  trigger,
  hapticType = 'selection',
  scaleValue,
  style,
  onPress,
  onLongPress,
  disabled,
  testID,
  accessibilityLabel,
  accessibilityRole,
  accessibilityState,
  accessibilityHint,
  children,
}: AnimatedListItemProps) {
  return (
    <AnimatedEntry index={index} staggerMs={staggerMs} maxItems={maxItems} trigger={trigger}>
      <AnimatedPressable
        hapticType={hapticType}
        scaleValue={scaleValue}
        style={style}
        onPress={onPress}
        onLongPress={onLongPress}
        disabled={disabled}
        testID={testID}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole}
        accessibilityState={accessibilityState}
        accessibilityHint={accessibilityHint}
      >
        {children}
      </AnimatedPressable>
    </AnimatedEntry>
  );
}

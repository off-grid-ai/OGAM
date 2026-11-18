import { useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';

/**
 * Returns a number that changes the first time the screen gains focus, and never again.
 * Pass it as `trigger` to AnimatedEntry / AnimatedListItem.
 *
 * It used to change on EVERY focus, so each tab visit replayed the staggered fade of every row:
 * a tab looked half-empty for a second each time you came back (hand check 2026-11-06, Mac: "moving
 * between tabs takes an unreal amount of time"). A list you have already seen is shown at once.
 *
 * It listens for the first focus instead of reading useIsFocused, which re-rendered the whole
 * screen on every tab switch, in and out (a 150-250 ms frame on a mid-range Android phone).
 */
export function useFocusTrigger(): number {
  const navigation = useNavigation();
  const [trigger, setTrigger] = useState(() => (navigation.isFocused?.() ?? true ? 1 : 0));
  useEffect(() => {
    if (trigger === 1) return undefined;
    return navigation.addListener('focus', () => setTrigger(1));
  }, [navigation, trigger]);
  return trigger;
}

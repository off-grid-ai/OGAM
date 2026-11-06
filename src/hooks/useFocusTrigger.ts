import { useRef, useEffect } from 'react';
import { useIsFocused } from '@react-navigation/native';

/**
 * Returns a number that changes the first time the screen gains focus, and never again.
 * Pass it as `trigger` to AnimatedEntry / AnimatedListItem.
 *
 * It used to change on EVERY focus, so each tab visit replayed the staggered fade of every row:
 * a tab looked half-empty for a second each time you came back (hand check 2026-11-06, Mac: "moving
 * between tabs takes an unreal amount of time"). A list you have already seen is shown at once.
 */
export function useFocusTrigger(): number {
  const isFocused = useIsFocused();
  const count = useRef(0);

  useEffect(() => {
    if (isFocused && count.current === 0) {
      count.current = 1;
    }
  }, [isFocused]);

  return count.current;
}

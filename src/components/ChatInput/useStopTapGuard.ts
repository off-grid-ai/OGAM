import { useCallback, useEffect, useRef } from 'react';

/** How long after Stop leaves that a tap on the same spot is still taken as the Stop tap. */
export const STOP_TAP_GRACE_MS = 700;

/**
 * Stop and the mic share one spot: when a reply ends, the mic takes Stop's place. A Stop tap that
 * lands just after the reply ended used to start recording (hand test 16). This wraps the mic's
 * start so a tap within the grace after Stop left does nothing.
 */
export function useStopTapGuard<A extends unknown[]>(
  isGenerating: boolean | undefined,
  start: (...args: A) => unknown,
  now: () => number = Date.now,
): (...args: A) => void {
  const stopLeftAt = useRef<number | null>(null);
  const wasGenerating = useRef(!!isGenerating);
  useEffect(() => {
    if (wasGenerating.current && !isGenerating) stopLeftAt.current = now();
    wasGenerating.current = !!isGenerating;
  }, [isGenerating, now]);
  return useCallback(
    (...args: A) => {
      const left = stopLeftAt.current;
      if (left !== null && now() - left < STOP_TAP_GRACE_MS) return;
      start(...args);
    },
    [start, now],
  );
}

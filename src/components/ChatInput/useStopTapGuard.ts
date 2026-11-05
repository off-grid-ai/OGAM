import { useCallback, useEffect, useRef } from 'react';
import { generationSession } from '../../services/generationSession';

/** How long after a reply ends that a tap on Stop's spot is still taken as the Stop tap. */
export const STOP_TAP_GRACE_MS = 2000;

/**
 * Stop and the mic share one spot: when a reply ends, the mic takes Stop's place. A Stop tap that
 * lands just after the reply ended used to start recording (hand tests 16-19). This wraps the mic's
 * start so a tap within the grace does nothing.
 *
 * The end time comes from the generation session (it owns when a turn ends), not from this
 * component's own memory: the composer can remount as a reply ends, and a remount forgot the moment
 * Stop left, which is why a local timer let late taps through on the device.
 */
export function useStopTapGuard<A extends unknown[]>(
  isGenerating: boolean | undefined,
  start: (...args: A) => unknown,
  now: () => number = Date.now,
): (...args: A) => void {
  // A reply this composer saw end also counts (a remote or engine path that never used the session).
  const localEndedAt = useRef<number | null>(null);
  const wasGenerating = useRef(!!isGenerating);
  useEffect(() => {
    if (wasGenerating.current && !isGenerating) localEndedAt.current = now();
    wasGenerating.current = !!isGenerating;
  }, [isGenerating, now]);
  return useCallback(
    (...args: A) => {
      const ended = Math.max(generationSession.lastEndedAt() ?? -Infinity, localEndedAt.current ?? -Infinity);
      if (Number.isFinite(ended) && now() - ended < STOP_TAP_GRACE_MS) return;
      start(...args);
    },
    [start, now],
  );
}

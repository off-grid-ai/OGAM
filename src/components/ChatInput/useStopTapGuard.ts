import { useCallback, useEffect, useRef, useState } from 'react';
import { generationSession } from '../../services/generationSession';

/** How long after a reply ends that a tap on Stop's spot is still taken as the Stop tap. */
export const STOP_TAP_GRACE_MS = 2000;

/**
 * Stop and the mic share one spot: when a reply ends, the mic takes Stop's place. A Stop tap that
 * lands just after the reply ended used to start recording, or flip the composer into "Tap mic to stop"
 * (hand tests 16-20). For the grace after a reply ends the mic rests: it is disabled, so a tap there
 * changes nothing at all, and its start is guarded as well.
 *
 * The end time comes from the generation session (it owns when a turn ends) as well as from what this
 * composer saw: the composer can remount as a reply ends, and a remount forgot the moment Stop left.
 */
export function useStopTapGuard<A extends unknown[]>(
  isGenerating: boolean | undefined,
  start: (...args: A) => unknown,
  now: () => number = Date.now,
): { start: (...args: A) => void; resting: boolean } {
  const localEndedAt = useRef<number | null>(null);
  const wasGenerating = useRef(!!isGenerating);
  const endedAt = useCallback(
    () => Math.max(generationSession.lastEndedAt() ?? -Infinity, localEndedAt.current ?? -Infinity),
    [],
  );
  const restsNow = useCallback(() => {
    const ended = endedAt();
    return Number.isFinite(ended) && now() - ended < STOP_TAP_GRACE_MS;
  }, [endedAt, now]);
  const [resting, setResting] = useState(restsNow);

  useEffect(() => {
    if (wasGenerating.current && !isGenerating) localEndedAt.current = now();
    wasGenerating.current = !!isGenerating;
    if (isGenerating || !restsNow()) {
      setResting(false);
      return undefined;
    }
    setResting(true);
    const left = STOP_TAP_GRACE_MS - (now() - endedAt());
    const timer = setTimeout(() => setResting(false), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [isGenerating, now, restsNow, endedAt]);

  const guarded = useCallback(
    (...args: A) => {
      if (restsNow()) return;
      start(...args);
    },
    [start, restsNow],
  );
  return { start: guarded, resting };
}

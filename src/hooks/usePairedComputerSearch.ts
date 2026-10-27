import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { RemoteSearchOutcome } from '@offgrid/rag';
import { useRemoteServerStore } from '../stores';
import { pairedComputer, searchPairedComputer } from '../services/pairedComputerSearch';
import type { RemoteServer } from '../types';
import logger from '../utils/logger';

/** Wait for typing to pause before asking the computer. */
const TYPING_PAUSE_MS = 300;

export type PairedComputerSearch =
  | { computer: null }
  | { computer: RemoteServer; outcome: RemoteSearchOutcome | 'searching' | null; retry: () => void };

/**
 * The paired computer's results for `query`, beside the phone's own. Each new query (and each
 * return to the screen, e.g. after entering a key) asks again and drops the older answer.
 */
export function usePairedComputerSearch(query: string): PairedComputerSearch {
  const computer = useRemoteServerStore(s => pairedComputer(s.servers, s.activeServerId));
  const [outcome, setOutcome] = useState<RemoteSearchOutcome | 'searching' | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  const trimmed = query.trim();

  useFocusEffect(retry);

  // A health check rewrites the server record; only a different computer or address asks again.
  const computerId = computer?.id;
  const endpoint = computer?.endpoint;
  useEffect(() => {
    const target = computerId ? useRemoteServerStore.getState().getServerById(computerId) : null;
    if (!target || !trimmed) {
      setOutcome(null);
      return undefined;
    }
    setOutcome('searching');
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchPairedComputer(target, trimmed, controller.signal)
        .then(next => {
          if (!controller.signal.aborted) setOutcome(next);
        })
        .catch(error => {
          if (controller.signal.aborted) return;
          logger.warn('[REMOTE-SEARCH] search failed:', error);
          setOutcome({ status: 'failed', message: error instanceof Error ? error.message : String(error) });
        });
    }, TYPING_PAUSE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [computerId, endpoint, trimmed, attempt]);

  return computer ? { computer, outcome, retry } : { computer: null };
}

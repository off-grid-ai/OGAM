import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertQueue, AlertState, dismissAlert, enqueueAlert, shownAlert } from '../utils/alertState';

/**
 * A screen's alert slot that never loses an alert: the same `alertState` / `setAlertState` pair as a
 * `useState<AlertState>`, but an alert raised while another is on screen waits its turn.
 *
 * `setAlertState(showAlert(...))` queues the alert. `setAlertState(hideAlert())` closes the alert
 * on screen. Closing is by the alert that was on screen, so a button that closes its alert before the
 * sheet's own close runs does not also close the next alert waiting.
 */
export function useAlertQueue(): { alertState: AlertState; setAlertState: (next: AlertState) => void } {
  const [queue, setQueue] = useState<AlertQueue>([]);
  const alertState = shownAlert(queue);
  const onScreen = useRef(alertState);
  useEffect(() => { onScreen.current = alertState; }, [alertState]);

  const setAlertState = useCallback((next: AlertState) => {
    if (next.visible) {
      setQueue(waiting => enqueueAlert(waiting, next));
      return;
    }
    const closed = onScreen.current;
    setQueue(waiting => dismissAlert(waiting, closed));
  }, []);

  return { alertState, setAlertState };
}

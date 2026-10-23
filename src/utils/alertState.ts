/**
 * Alert STATE — a pure, React-free descriptor of an alert + the factories that build it. Lives in
 * the pure layer (not in the CustomAlert component) so non-UI code (e.g. services/loadModelWithOverride,
 * which owns the Load-Anyway flow) can construct an alert state to hand back to a screen WITHOUT a
 * service → component dependency (no-backward-layering-core). The CustomAlert component imports and
 * RE-EXPORTS these, so existing `from '../components/CustomAlert'` importers keep working.
 */

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface AlertState {
  visible: boolean;
  title: string;
  message?: string;
  buttons?: AlertButton[];
  loading?: boolean;
  closeLabel?: string;
  prominentMessage?: boolean;
}

export const initialAlertState: AlertState = {
  visible: false,
  title: '',
  message: undefined,
  buttons: undefined,
  loading: false,
};

/** Build the state for a visible alert (to hand to a screen's setAlertState). */
export const showAlert = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
): AlertState => ({
  visible: true,
  title,
  message,
  buttons,
  loading: false,
});

/** Build the state for a dismissed alert. */
export const hideAlert = (): AlertState => initialAlertState;

/** Alerts waiting to be seen, the one on screen first. Two alerts raised together (a download is
 *  ready while a queued one is refused) are both shown, one after the other, never overwritten. */
export type AlertQueue = readonly AlertState[];

const sameAlert = (a: AlertState, b: AlertState): boolean => a.title === b.title && a.message === b.message;

/** The queue with `alert` added behind what is waiting; an alert already waiting is not added twice. */
export const enqueueAlert = (queue: AlertQueue, alert: AlertState): AlertQueue =>
  queue.some(waiting => sameAlert(waiting, alert)) ? queue : [...queue, alert];

/** The queue without `alert` (the one the person closed); the next one waiting comes on screen. */
export const dismissAlert = (queue: AlertQueue, alert: AlertState): AlertQueue =>
  queue.filter(waiting => waiting !== alert);

/** The alert on screen: the first one waiting, or none. */
export const shownAlert = (queue: AlertQueue): AlertState => queue[0] ?? initialAlertState;

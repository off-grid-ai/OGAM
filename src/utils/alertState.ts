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

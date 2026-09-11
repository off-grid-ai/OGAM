import { showAlert, type AlertState } from './CustomAlert';
import { formatBytes } from '../utils/formatBytes';

/** One confirmation contract for destructive model removal on every model surface. */
export function buildModelDeleteConfirmation(input: {
  readonly fileName: string;
  readonly totalBytes: number;
  readonly onDelete: () => void;
}): AlertState {
  return showAlert(
    'Delete Model',
    `Are you sure you want to delete "${input.fileName}"? This will free up ${formatBytes(input.totalBytes)}.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: input.onDelete },
    ],
  );
}

import { imageDownloadCompatibility } from '@offgrid/models';
import { hideAlert, showAlert } from '../utils/alertState';
import type { ImageDownloadDeps, ImageModelDescriptor } from './imageModelDownloadTypes';

/** Presentation bridge. Shared owns the compatibility verdict and variant matrix. */
export function getQnnWarningMessage(
  model: ImageModelDescriptor,
  facts: { hasNPU: boolean; qnnVariant?: string },
): string | null {
  const result = imageDownloadCompatibility(model, {
    platform: 'android', hasNpu: facts.hasNPU, qnnVariant: facts.qnnVariant,
  });
  return result.status === 'compatible' ? null : result.message;
}

export function showQnnWarningAlert(
  input: {
    warningMessage: string;
    hasNPU: boolean;
    modelInfo: ImageModelDescriptor;
    onDownloadAnyway: () => void;
  },
  deps: ImageDownloadDeps,
): void {
  deps.setAlertState(showAlert('Incompatible Model', input.warningMessage, input.hasNPU
    ? [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Download Anyway', style: 'destructive', onPress: () => {
          deps.setAlertState(hideAlert()); input.onDownloadAnyway();
        } },
      ]
    : [{ text: 'OK', style: 'cancel' }],
  ));
}

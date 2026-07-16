import { hideAlert, showAlert } from '../../components/CustomAlert';
import { ImageModelDescriptor, ImageDownloadDeps } from './types';

export function getQnnWarningMessage(
  modelInfo: ImageModelDescriptor,
  socInfo: { hasNPU: boolean; qnnVariant?: string },
): string | null {
  if (!socInfo.hasNPU) {
    return 'NPU models require a Qualcomm Snapdragon processor. ' +
      'Your device does not have a compatible NPU and this model will not work. ' +
      'Consider downloading a CPU model instead.';
  }
  if (!modelInfo.variant || !socInfo.qnnVariant) return null;

  const deviceVariant = socInfo.qnnVariant;
  const modelVariant = modelInfo.variant;
  const compatible =
    modelVariant === deviceVariant || deviceVariant === '8gen2' ||
    (deviceVariant === '8gen1' && modelVariant !== '8gen2');
  if (compatible) return null;

  return `This model is built for ${modelVariant === '8gen2' ? 'flagship' : modelVariant} Snapdragon chips. ` +
    `Your device uses a ${deviceVariant === 'min' ? 'non-flagship' : deviceVariant} chip and this model will likely crash. ` +
    `Download the non-flagship variant instead.`;
}

export function showQnnWarningAlert(
  opts: {
    warningMessage: string;
    hasNPU: boolean;
    modelInfo: ImageModelDescriptor;
    onDownloadAnyway: () => void;
  },
  deps: ImageDownloadDeps,
): void {
  const { warningMessage, hasNPU, onDownloadAnyway } = opts;
  if (hasNPU) {
    deps.setAlertState(showAlert('Incompatible Model', warningMessage, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Download Anyway',
        style: 'destructive',
        onPress: () => {
          deps.setAlertState(hideAlert());
          onDownloadAnyway();
        },
      },
    ]));
    return;
  }

  deps.setAlertState(showAlert('Incompatible Model', warningMessage, [
    { text: 'OK', style: 'cancel' },
  ]));
}

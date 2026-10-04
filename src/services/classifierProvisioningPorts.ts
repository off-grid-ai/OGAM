/**
 * Ports for Shared classifier provisioning. Shared owns concurrency, artifact choice,
 * download/select decisions, and recovery; this only reports facts and performs requests.
 */
import type { ClassifierProvisioningService } from '@offgrid/models';
import type { DownloadedModel, ModelFile } from '../types';
import { useAppStore } from '../stores';
import { nativeDownloadTransferAdapter } from './adapters/downloads/nativeDownloadTransferAdapter';
import { huggingFaceService } from './huggingface';
import { selectMobileModel } from './modelServices/selectionCommands';
import { explicitLocalModelId } from './modelServices/modelSelectionProjection';
import { applicationFacade } from './applicationFacade';
import { makeModelKey } from '../utils/modelKey';

export type ClassifierModel = DownloadedModel & { hostId: string };

/** Store snapshot, discovery, selection, and download ports. Shared owns provisioning. */
export function mobileClassifierProvisioningPorts(): ConstructorParameters<typeof ClassifierProvisioningService<ModelFile, ClassifierModel>>[0] {
  return {
  snapshot: () => {
    const state = useAppStore.getState();
    return {
      selectedModelId: explicitLocalModelId('classifier'),
      downloadedModels: state.downloadedModels.map(model => ({
        ...model,
        hostId: model.engine,
      })),
      backgroundDownloadSupported:
        nativeDownloadTransferAdapter.isAvailable(),
    };
  },
  discover: repository => huggingFaceService.getModelFiles(repository),
  select: model => selectMobileModel({
    source: 'local',
    hostId: model.hostId,
    modality: 'classifier',
    modelId: model.id,
  }),
  download: async (repository, artifact, callbacks) => {
    const outcome = await applicationFacade().models.control({
      type: 'download',
      modelId: makeModelKey(repository, artifact.name),
      selection: { repositoryId: repository, fileName: artifact.name },
    });
    if (!outcome.ok || outcome.value.status !== 'completed') {
      callbacks.onError();
      return;
    }
    const installed = useAppStore.getState().downloadedModels.find(
      model => model.id === makeModelKey(repository, artifact.name),
    );
    if (!installed) {
      callbacks.onError();
      return;
    }
    callbacks.onRegistered({ ...installed, hostId: installed.engine });
  },
};
}

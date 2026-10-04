import { catalogKindForArtifact, catalogModelKind } from '@offgrid/models';
import type { ModelsActivationHostPort } from '@offgrid/application';
import { useAppStore } from '../../stores/appStore';

/** Local registry facts for Shared's activation policy. */
export const mobileModelActivationHostPort: ModelsActivationHostPort = {
  async resolve(modelId, requestedKind) {
    const { downloadedImageModels, downloadedModels } = useAppStore.getState();
    if (downloadedImageModels.some(model => model.id === modelId)) {
      return {
        kind: 'image',
        supportsRequestedKind: requestedKind === 'image',
      };
    }
    const model = downloadedModels.find(candidate => candidate.id === modelId);
    if (!model) return null;
    return {
      kind: catalogKindForArtifact(model) ?? catalogModelKind(model.name, [], model.id),
    };
  },
};

import { visionMetadataRepairIds } from '@offgrid/models';
import type { ModelMetadataRepairCommandService } from '@offgrid/models';
import { visionMetadataRepair } from '../composition/model-library-services';
import type { DownloadedModel, ModelFile } from '../../types';
import { modelLibrary } from './bootstrap/modelLibraryBootstrap';

type VisionMetadataRepairInput = {
  modelId: string
  files: readonly ModelFile[]
  resolveDownloaded(modelId: string, fileName: string): DownloadedModel | undefined
};

/** Registry facts and writes for one repair. Shared decides what to repair. */
function mobileVisionMetadataRepairPorts(
  input: VisionMetadataRepairInput,
): ConstructorParameters<typeof ModelMetadataRepairCommandService<string[]>>[0] {
  return {
    resolve: async () => {
      const ids = visionMetadataRepairIds(input.files.map(file => {
        const model = input.resolveDownloaded(input.modelId, file.name);
        return {
          id: model?.id ?? '',
          engine: model?.engine,
          hasProjector: Boolean(file.mmProjFile),
          visionRecorded: model?.engine === 'llama' ? model.isVisionModel : false,
        };
      }).filter(row => row.id));
      return ids.length > 0 ? ids : null;
    },
    persist: async ids => { await Promise.all(ids.map(id => modelLibrary.markVisionModel(id))); },
    reload: () => undefined,
  };
}

/** Mobile adapter for the Shared metadata-repair transaction. */
export function repairDownloadedVisionMetadata(input: VisionMetadataRepairInput): Promise<boolean> {
  const command = visionMetadataRepair(mobileVisionMetadataRepairPorts(input));
  return command.execute();
}

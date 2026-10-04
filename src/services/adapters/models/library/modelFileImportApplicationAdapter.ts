import RNFS from 'react-native-fs';
import {
  resolveImportedModelUri,
  type ModelFileImportDecision,
  type ModelImportArtifact,
} from '@offgrid/models';
import type { ModelFileImportApplicationService } from '@offgrid/models';
import type {
  DownloadedModel,
  LiteRTDownloadedModel,
  LlamaDownloadedModel,
  ModelFile,
} from '../../../../types';
import { statFile } from '../../../../utils/fileStat';
import { copyFileWithProgress } from '../modelFileCopyAdapter';
import {
  buildDownloadedModel,
  persistDownloadedModel,
} from './modelRegistryStorageAdapter';
import { modelFileImport } from '../../../composition/model-library-services';

export interface MobileModelFileImportInput {
  modelsDir: string;
  artifacts: readonly ModelImportArtifact[];
  decide(request: ModelFileImportDecision): Promise<boolean>;
  onProgress?(progress: { fraction: number; fileName: string }): void;
  refresh(model: DownloadedModel): void;
}

/** Copy, size, and registry ports for one import. Shared owns the decisions. */
function mobileModelFileImportPorts(
  input: MobileModelFileImportInput,
): ConstructorParameters<typeof ModelFileImportApplicationService<DownloadedModel>>[0] {
  return {
    decide: input.decide,
    destinationPath: fileName => `${input.modelsDir}/${fileName}`,
    exists: path => RNFS.exists(path),
    copy: ({ source, destination, expectedBytes, onProgress }) =>
      copyFileWithProgress(resolveImportedModelUri(source), destination, {
        knownTotalBytes: expectedBytes,
        onProgress,
      }),
    size: async path => (await statFile(path))?.size ?? 0,
    remove: path => RNFS.unlink(path),
    async register(registration) {
      const file: ModelFile = {
        name: registration.primary.name,
        size: registration.primary.storedSizeBytes,
        quantization: registration.quantization,
        downloadUrl: '',
      };
      const base = await buildDownloadedModel({
        modelId: 'local_import',
        file,
        resolvedLocalPath: registration.primary.path,
      });
      const common = {
        ...base,
        id: `local_import/${registration.primary.name}`,
        name: registration.modelName,
        author: 'Local Import',
        credibility: {
          source: 'community' as const,
          isOfficial: false,
          isVerifiedQuantizer: false,
        },
      };
      const model: DownloadedModel =
        registration.engine === 'litert'
          ? ({
              ...common,
              engine: 'litert',
              liteRTVision: registration.liteRTVision ?? false,
            } as LiteRTDownloadedModel)
          : ({
              ...common,
              engine: 'llama',
              ...(registration.projector
                ? {
                    mmProjPath: registration.projector.path,
                    mmProjFileName: registration.projector.name,
                    mmProjFileSize: registration.projector.storedSizeBytes,
                    isVisionModel: true,
                  }
                : {}),
            } as LlamaDownloadedModel);
      await persistDownloadedModel(model, input.modelsDir);
      return model;
    },
    refresh: input.refresh,
  };
}

export function importSelectedModelFiles(input: MobileModelFileImportInput) {
  const service = modelFileImport(mobileModelFileImportPorts(input));
  return service.execute({
    artifacts: input.artifacts,
    liteRTAvailable: true,
    onProgress: input.onProgress,
  });
}


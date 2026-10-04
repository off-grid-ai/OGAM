import RNFS from 'react-native-fs';
import {
  WHISPER_MODELS,
  type ModelLibraryPort,
} from '@offgrid/application';
import type {ModelLibraryRemovalTarget} from '@offgrid/models';
import {
  commitImageModelsList,
  commitModelsList,
} from '../adapters/models/library/modelRegistryStorageAdapter';
import {modelLibrary} from './bootstrap/modelLibraryBootstrap';
import {modelLibraryPathFileName} from './modelLibraryLocalImportPorts';
import * as whisperModelFiles from '../whisperModelFiles';
import type {MobileManagedArtifactIO} from './modelDownloadArtifactIO';

type MobileRemovalTarget = ModelLibraryRemovalTarget & {
  source: 'managed' | 'whisper' | 'text' | 'image';
};

async function resolveRemoval(
  modelId: string,
  managed: MobileManagedArtifactIO | undefined,
): Promise<MobileRemovalTarget | null> {
  if (managed?.ownsModel(modelId)) {
    return {
      source: 'managed',
      modelId,
      requestedId: modelId,
      files: [],
      runtimeManaged: true,
    };
  }
  if (WHISPER_MODELS.some(model => model.id === modelId)) {
    return {
      source: 'whisper',
      modelId,
      requestedId: modelId,
      files: [],
      runtimeManaged: true,
    };
  }
  const textModels = await modelLibrary.getDownloadedModels();
  const text = textModels.find(model => model.id === modelId);
  if (text) {
    const primary = modelLibraryPathFileName(text.filePath);
    const files = [primary];
    if (text.engine === 'llama' && text.mmProjPath) {
      files.push(modelLibraryPathFileName(text.mmProjPath));
    }
    const retainedFiles = new Set(
      textModels.flatMap(model =>
        model.id !== modelId && model.engine === 'llama' && model.mmProjPath
          ? [modelLibraryPathFileName(model.mmProjPath)]
          : [],
      ),
    );
    return {
      source: 'text',
      modelId: text.id,
      requestedId: modelId,
      primaryFile: primary,
      files,
      retainedFiles,
      strictFileRemoval: true,
    };
  }
  const image = (await modelLibrary.getDownloadedImageModels()).find(
    model => model.id === modelId,
  );
  return image
    ? {
        source: 'image',
        modelId,
        requestedId: modelId,
        files: [],
        runtimeManaged: true,
      }
    : null;
}

/** Mobile resource I/O for Shared's removal and selection-cleanup transaction. */
export function mobileRemovalPorts(
  modelsDir: string,
  managed?: MobileManagedArtifactIO,
): ModelLibraryPort['removal'] {
  return {
    resolve: modelId => resolveRemoval(modelId, managed),
    async removeFile(fileName) {
      const path = `${modelsDir}/${fileName}`;
      const existed = await RNFS.exists(path);
      if (existed) await RNFS.unlink(path);
      return existed;
    },
    async removePartial(fileName) {
      const path = `${modelsDir}/${fileName}.part`;
      if (await RNFS.exists(path)) await RNFS.unlink(path);
    },
    async removeRuntime(target) {
      const mobile = target as MobileRemovalTarget;
      if (mobile.source === 'managed') {
        await managed!.removeModel(target.modelId);
        return;
      }
      if (mobile.source === 'whisper') {
        const path = whisperModelFiles.getModelPath(target.modelId);
        if (await RNFS.exists(path)) await RNFS.unlink(path);
        return;
      }
      if (mobile.source === 'image') {
        const path = `${modelLibrary.getImageModelsDirectory()}/${target.modelId}`;
        if (await RNFS.exists(path)) await RNFS.unlink(path);
      }
    },
    async unregister(target) {
      const mobile = target as MobileRemovalTarget;
      if (mobile.source === 'text') {
        await commitModelsList(
          (await modelLibrary.getDownloadedModels()).filter(
            model => model.id !== target.modelId,
          ),
        );
      } else if (mobile.source === 'image') {
        await commitImageModelsList(
          (await modelLibrary.getDownloadedImageModels()).filter(
            model => model.id !== target.modelId,
          ),
        );
      }
    },
  };
}

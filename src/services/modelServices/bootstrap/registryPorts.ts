import RNFS from 'react-native-fs';
import type { ModelLibraryRegistryService } from '@offgrid/models';
import type { DownloadedModel, ONNXImageModel } from '../../../types';
import {
  saveModelsList,
  saveImageModelsList,
  loadDownloadedModels,
  loadDownloadedImageModels,
} from '../../adapters/models/library/modelRegistryStorageAdapter';
import { isSafeImageModelId } from '@offgrid/models';
import { resolveOwnedDocumentPath } from '../../../utils/resolveDocumentPath';
import { readRegistry } from './registryRead';

/** Registry storage, owned paths, and free space for the text and image libraries. I/O only. */
export function mobileModelLibraryRegistryPorts(
  modelsDir: string,
  imageModelsDir: string,
): ConstructorParameters<typeof ModelLibraryRegistryService<DownloadedModel, ONNXImageModel>>[0] {
  return {
    listText: () => readRegistry('text', () => loadDownloadedModels(modelsDir)),
    saveText: saveModelsList,
    listImages: () => readRegistry(
      'image',
      () => loadDownloadedImageModels(imageModelsDir),
    ),
    saveImages: saveImageModelsList,
    resolveOwnedTextPath: path =>
      resolveOwnedDocumentPath(path, modelsDir),
    imageRoot: modelId =>
      isSafeImageModelId(modelId)
        ? `${imageModelsDir}/${modelId}`
        : null,
    exists: path => RNFS.exists(path),
    remove: path => RNFS.unlink(path),
    freeSpace: async () => (await RNFS.getFSInfo()).freeSpace,
  };
}

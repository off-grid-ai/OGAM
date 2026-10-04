import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import type { ImageArchiveImportService } from '@offgrid/models';
import type { ONNXImageModel } from '../../../../types';
import { useAppStore } from '../../../../stores/appStore';
import { resolveCoreMLModelDir } from '../../../../utils/coreMLModelUtils';
import { getDirectorySize } from '../../filesystem/directorySize';
import { modelLibrary } from '../../../modelServices/bootstrap/modelLibraryBootstrap';
import { readMobileModelSelection } from '../../../modelServices/modelSelectionProjection';
import { selectMobileModel } from '../../../modelServices/selectionCommands';
import { refreshMobileLLMServiceInventory } from '../../../modelServices/mobileLLMService';

/** Filesystem, registry, and selection ports. Shared owns the import transaction. */
export function mobileImageArchiveImportPorts(): ConstructorParameters<typeof ImageArchiveImportService>[0] {
  return {
  imageModelsDirectory: () => modelLibrary.getImageModelsDirectory(),
  ensureDirectory: async path => { if (!(await RNFS.exists(path))) await RNFS.mkdir(path); },
  stagePickedArchive: (sourceUri, archivePath) =>
    Platform.OS === 'ios' ? RNFS.moveFile(sourceUri, archivePath) : RNFS.copyFile(sourceUri, archivePath),
  extractArchive: async (archivePath, destinationPath) => { await unzip(archivePath, destinationPath); },
  listDirectory: async path => (await RNFS.readDir(path)).map(entry => ({
    name: entry.name,
    directory: entry.isDirectory(),
  })),
  resolveModelDirectory: (rootPath, backend) =>
    backend === 'coreml' ? resolveCoreMLModelDir(rootPath) : Promise.resolve(rootPath),
  directorySize: getDirectorySize,
  remove: path => RNFS.unlink(path),
  async register(model) {
    const mobile = model as ONNXImageModel;
    await modelLibrary.addDownloadedImageModel(mobile);
    useAppStore.getState().addDownloadedImageModel(mobile);
    // The Shared import transaction activates the newly registered model next. Publish the
    // platform registry into Shared's inventory before that selection command runs, so selection
    // resolves against the authoritative application snapshot instead of stale inventory.
    await refreshMobileLLMServiceInventory();
  },
  currentSelection: async () => readMobileModelSelection('image'),
  async activate(model) {
    await selectMobileModel({
      source: 'local',
      hostId: model.backend ?? 'image-runtime',
      modality: 'image',
      modelId: model.id,
    });
  },
  async refresh() {
    useAppStore.getState().setDownloadedImageModels(await modelLibrary.getDownloadedImageModels());
    await refreshMobileLLMServiceInventory();
  },
  now: () => Date.now(),
};
}

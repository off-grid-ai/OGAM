// Composition root: the model-library services whose ports are handed IN by the caller, plus the
// registry, which needs only filesystem ports. Nothing here reaches an app-composed instance, so the
// low-level modules that build these services (the library bootstrap, the vision-repair and
// file-import adapters, the metadata-repair and readiness ports) can import this module directly
// without depending on the singletons in `model-library.ts`.
import {
  ChatModelReadinessService,
  ModelFileImportApplicationService,
  ModelLibraryRegistryService,
  ModelMetadataRepairCommandService,
} from '@offgrid/models';
import type { DownloadedModel, ONNXImageModel } from '../../types';
import { mobileModelLibraryRegistryPorts } from '../modelServices/bootstrap/registryPorts';

export function modelLibraryRegistry(
  modelsDir: string,
  imageModelsDir: string,
): ModelLibraryRegistryService<DownloadedModel, ONNXImageModel> {
  return new ModelLibraryRegistryService(mobileModelLibraryRegistryPorts(modelsDir, imageModelsDir));
}
export function visionMetadataRepair(
  ports: ConstructorParameters<typeof ModelMetadataRepairCommandService<string[]>>[0],
): ModelMetadataRepairCommandService<string[]> {
  return new ModelMetadataRepairCommandService<string[]>(ports);
}
export function chatModelReadiness(
  ports: ConstructorParameters<typeof ChatModelReadinessService>[0],
): ChatModelReadinessService {
  return new ChatModelReadinessService(ports);
}
export function modelFileImport(
  ports: ConstructorParameters<typeof ModelFileImportApplicationService<DownloadedModel>>[0],
): ModelFileImportApplicationService<DownloadedModel> {
  return new ModelFileImportApplicationService<DownloadedModel>(ports);
}

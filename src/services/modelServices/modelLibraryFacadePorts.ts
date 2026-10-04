import type {ModelLibraryPort} from '@offgrid/application';
import {modelLibrary} from './bootstrap/modelLibraryBootstrap';
import {mobileLocalImportPorts} from './modelLibraryLocalImportPorts';
import {mobileRemovalPorts} from './modelLibraryRemovalPorts';
import {mobileTransferPorts} from './modelLibraryTransferPorts';
import type {MobileManagedArtifactIO} from './modelDownloadArtifactIO';

/** Compose Mobile I/O ports only. Shared constructs and owns every library transaction. */
export function createMobileModelLibraryFacadePorts(
  managed?: MobileManagedArtifactIO,
): ModelLibraryPort {
  const modelsDir = modelLibrary.getModelsDirectory();
  return {
    localImport: mobileLocalImportPorts(modelsDir),
    transfer: mobileTransferPorts(modelsDir),
    removal: mobileRemovalPorts(modelsDir, managed),
  };
}

import {
  CATALOG,
  planImportedModel,
  type ModelTransferRegistrationManifest,
} from '@offgrid/models';
import type {ModelLibraryPort} from '@offgrid/application';
import {modelPackageIdentity, type TransferredModelManifest} from '@offgrid/sync';
import type {LlamaDownloadedModel, ModelFile} from '../../types';
import {statFile} from '../../utils/fileStat';
import {
  buildDownloadedModel,
  commitModelsList,
  determineCredibility,
} from '../adapters/models/library/modelRegistryStorageAdapter';
import {modelLibrary} from './bootstrap/modelLibraryBootstrap';
import {mobileLocalImportPorts} from './modelLibraryLocalImportPorts';

async function transferredDownloadedModel(
  input: {
    id: string;
    familyId: string;
    manifest: ModelTransferRegistrationManifest;
  },
  modelsDir: string,
): Promise<LlamaDownloadedModel> {
  // The sending side already labelled every file. Guessing again from the file name here was a
  // second rule that could disagree with it, which is how a projector gets installed as the model.
  const projector = input.manifest.files.find(
    file => file.role === 'projector',
  );
  const primary = input.manifest.files.find(file => file !== projector);
  if (!primary) throw new Error('Transferred model has no primary GGUF file.');
  const projectorPath = projector ? `${modelsDir}/${projector.name}` : undefined;
  const file: ModelFile = {
    name: primary.name,
    size: primary.sizeBytes,
    quantization: planImportedModel(primary.name, Boolean(projector)).quantization,
    downloadUrl: '',
    ...(projector
      ? {
          mmProjFile: {
            name: projector.name,
            size: projector.sizeBytes,
            downloadUrl: '',
          },
        }
      : {}),
  };
  const base = await buildDownloadedModel({
    modelId: input.familyId,
    file,
    resolvedLocalPath: `${modelsDir}/${primary.name}`,
    mmProjPath: projectorPath,
    origin: input.manifest.origin,
  });
  if (base.engine !== 'llama') {
    throw new Error('A transferred GGUF model requires the llama runtime.');
  }
  const author = input.familyId.split('/')[0] || 'Unknown';
  return {
    ...base,
    id: input.id,
    name: input.manifest.name,
    author,
    credibility: determineCredibility(author),
  };
}

/** Mobile filesystem and registry facts for Shared's transfer-registration transaction. */
export function mobileTransferPorts(modelsDir: string): ModelLibraryPort['transfer'] {
  const local = mobileLocalImportPorts(modelsDir);
  return {
    libraryId: () => modelsDir,
    async validateFiles(manifest) {
      for (const file of manifest.files) {
        const facts = await statFile(`${modelsDir}/${file.name}`);
        if (!facts?.isFile || facts.size !== file.sizeBytes) {
          return 'Transferred model file does not match its manifest';
        }
      }
      return null;
    },
    async catalogFiles(modelId) {
      return CATALOG.find(model => model.id === modelId)?.files.map(file => file.name) ?? null;
    },
    readLocalModels: local.readLocalModels,
    writeLocalModels: local.writeLocalModels,
    async recordDownloaded({id, familyId, manifest}) {
      const current = await modelLibrary.getDownloadedModels();
      const model = await transferredDownloadedModel({id, familyId, manifest}, modelsDir);
      await commitModelsList([
        ...current.filter(candidate => candidate.id !== id),
        model,
      ]);
    },
    async hasDownloaded(id) {
      return (await modelLibrary.getDownloadedModels()).some(model => model.id === id);
    },
    packageIdentity: manifest =>
      modelPackageIdentity(manifest as TransferredModelManifest),
  };
}

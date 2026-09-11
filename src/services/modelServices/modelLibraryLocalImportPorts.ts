import RNFS from 'react-native-fs';
import {
  isGgufFile,
  planImportedModel,
  resolveImportedModelUri,
  type LocalModelImportPorts,
  type RegisteredLocalModel,
} from '@offgrid/models';
import type {DownloadedModel, LlamaDownloadedModel, ModelFile} from '../../types';
import {statFile} from '../../utils/fileStat';
import {copyFileWithProgress} from '../adapters/models/modelFileCopyAdapter';
import {
  buildDownloadedModel,
  commitModelsList,
  determineCredibility,
} from '../adapters/models/library/modelRegistryStorageAdapter';
import {validateModelFile} from '../llmSafetyChecks';
import {modelLibrary} from './bootstrap/modelLibraryBootstrap';

export function modelLibraryPathFileName(path: string): string {
  const value = path.split('/').pop();
  if (!value) throw new Error('The imported model path has no file name.');
  return decodeURIComponent(value);
}

function isLocalImport(model: DownloadedModel): boolean {
  return model.id.startsWith('local:') || model.id.startsWith('local_import/');
}

function registeredLocalModel(model: DownloadedModel): RegisteredLocalModel {
  const primary = modelLibraryPathFileName(model.filePath);
  return {
    id: model.id.startsWith('local_import/') ? `local:${primary}` : model.id,
    name: model.name,
    primary,
    ...(model.engine === 'llama' && model.mmProjPath
      ? {mmproj: modelLibraryPathFileName(model.mmProjPath), kind: 'vision' as const}
      : {kind: 'text' as const}),
    sizeBytes: model.fileSize,
  };
}

async function downloadedModelForLocal(
  model: RegisteredLocalModel,
  modelsDir: string,
): Promise<LlamaDownloadedModel> {
  const plan = planImportedModel(model.primary, Boolean(model.mmproj));
  const primaryPath = `${modelsDir}/${model.primary}`;
  const projectorPath = model.mmproj ? `${modelsDir}/${model.mmproj}` : undefined;
  const file: ModelFile = {
    name: model.primary,
    size: model.sizeBytes,
    quantization: plan.quantization,
    downloadUrl: '',
    ...(model.mmproj
      ? {
          mmProjFile: {
            name: model.mmproj,
            size: (await statFile(projectorPath!))?.size ?? 0,
            downloadUrl: '',
          },
        }
      : {}),
  };
  const base = await buildDownloadedModel({
    modelId: 'local',
    file,
    resolvedLocalPath: primaryPath,
    mmProjPath: projectorPath,
  });
  if (base.engine !== 'llama') {
    throw new Error('A local GGUF import requires the llama runtime.');
  }
  return {
    ...base,
    id: model.id,
    name: model.name,
    author: 'Local Import',
    credibility: determineCredibility('Local Import'),
  };
}

/** Mobile file and registry facts for Shared's local-import transaction. */
export function mobileLocalImportPorts(modelsDir: string): LocalModelImportPorts {
  return {
    async inspect(source) {
      const resolved = resolveImportedModelUri(source);
      const fileName = modelLibraryPathFileName(resolved);
      if (!isGgufFile(fileName)) {
        return {
          fileName,
          sizeBytes: 0,
          valid: false,
          error: 'The selected file is not a GGUF model.',
        };
      }
      const facts = await statFile(resolved);
      if (!facts?.isFile || facts.size <= 0) {
        return {
          fileName,
          sizeBytes: 0,
          valid: false,
          error: 'The selected model file is unavailable.',
        };
      }
      const verification = await validateModelFile(resolved);
      return {
        fileName,
        sizeBytes: facts.size,
        valid: verification.valid,
        ...(verification.reason ? {error: verification.reason} : {}),
      };
    },
    async destinationHasSize(fileName, sizeBytes) {
      return (await statFile(`${modelsDir}/${fileName}`))?.size === sizeBytes;
    },
    async copy({source, fileName, sizeBytes, onBytes}) {
      await modelLibrary.initialize();
      await copyFileWithProgress(
        resolveImportedModelUri(source),
        `${modelsDir}/${fileName}`,
        {
          knownTotalBytes: sizeBytes,
          onProgress: fraction => onBytes(Math.round(fraction * sizeBytes)),
        },
      );
    },
    async removeDestination(fileName) {
      const destination = `${modelsDir}/${fileName}`;
      if (await RNFS.exists(destination)) await RNFS.unlink(destination);
    },
    async readLocalModels() {
      return (await modelLibrary.getDownloadedModels())
        .filter(isLocalImport)
        .map(registeredLocalModel);
    },
    async writeLocalModels(models) {
      const current = await modelLibrary.getDownloadedModels();
      const retained = current.filter(model => !isLocalImport(model));
      const imported = await Promise.all(
        models.map(model => downloadedModelForLocal(model, modelsDir)),
      );
      await commitModelsList([...retained, ...imported]);
    },
  };
}

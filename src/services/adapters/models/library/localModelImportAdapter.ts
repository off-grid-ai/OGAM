import RNFS from 'react-native-fs';
import { statFile } from '../../../../utils/fileStat';
import {
  DownloadedModel,
  LiteRTDownloadedModel,
  LlamaDownloadedModel,
  ModelEngine,
  ModelFile,
} from '../../../../types';
import { buildDownloadedModel, persistDownloadedModel } from './modelRegistryStorageAdapter';
import { copyFileWithProgress } from '../modelFileCopyAdapter';
import {
  importedModelProgress,
  planImportedModel,
  resolveImportedModelUri,
} from '@offgrid/models';

export interface ImportLocalModelOpts {
  sourceUri: string;
  fileName: string;
  modelsDir: string;
  sourceSize?: number | null;
  engine?: ModelEngine;
  liteRTVision?: boolean;
  onProgress?: (progress: { fraction: number; fileName: string }) => void;
  mmProjSourceUri?: string;
  mmProjFileName?: string;
  mmProjSourceSize?: number | null;
}


/**
 * Bringing a file the USER picked into the library.
 *
 * A different job from scan.ts, which adopts files already sitting in the models dir after a crash or a
 * reinstall. Split out when scan.ts crossed the size cap: one file was doing recovery, projector linking,
 * image-zip reconciliation AND local import.
 */
export async function importLocalModel(opts: ImportLocalModelOpts): Promise<DownloadedModel> { // NOSONAR
  const { sourceUri, fileName, modelsDir, sourceSize, engine: _engine, liteRTVision, onProgress, mmProjSourceUri, mmProjFileName, mmProjSourceSize } = opts;

  const plan = planImportedModel(fileName, Boolean(mmProjFileName));
  const resolvedSource = resolveImportedModelUri(sourceUri);
  const resolvedMmProjSource = mmProjSourceUri ? resolveImportedModelUri(mmProjSourceUri) : undefined;

  const destPath = `${modelsDir}/${fileName}`;
  const destExists = await RNFS.exists(destPath);
  if (destExists) throw new Error(`A model file named "${fileName}" already exists`);
  if (mmProjFileName && await RNFS.exists(`${modelsDir}/${mmProjFileName}`)) {
    throw new Error(`A file named "${mmProjFileName}" already exists`);
  }

  // Copy main model: progress 0→0.5 when mmproj present, 0→1 otherwise
  await copyFileWithProgress(resolvedSource, destPath, {
    knownTotalBytes: sourceSize ?? null,
    onProgress: onProgress ? (fraction: number) => onProgress({ fraction: importedModelProgress(plan, 'primary', fraction), fileName }) : undefined,
  });

  const fileSize = (await statFile(destPath))?.size ?? 0;

  const pseudoFile: ModelFile = { name: fileName, size: fileSize, quantization: plan.quantization, downloadUrl: '' };
  const baseModel = await buildDownloadedModel({ modelId: 'local_import', file: pseudoFile, resolvedLocalPath: destPath });
  const baseFields = {
    id: `local_import/${fileName}`,
    name: plan.modelName,
    author: 'Local Import',
    credibility: { source: 'community' as const, isOfficial: false, isVerifiedQuantizer: false },
  };

  if (plan.engine === 'litert') {
    const liteRTModel: LiteRTDownloadedModel = {
      ...baseModel, ...baseFields, engine: 'litert', liteRTVision: liteRTVision ?? false,
    };
    await persistDownloadedModel(liteRTModel, modelsDir);
    return liteRTModel;
  }

  const llamaModel: LlamaDownloadedModel = { ...baseModel, ...baseFields, engine: 'llama' };

  // Copy mmproj and link it to the model: progress 0.5→1
  if (mmProjFileName && resolvedMmProjSource) {
    const mmProjDestPath = `${modelsDir}/${mmProjFileName}`;
    await copyFileWithProgress(resolvedMmProjSource, mmProjDestPath, {
      knownTotalBytes: mmProjSourceSize ?? null,
      onProgress: onProgress
        ? (fraction: number) => onProgress({ fraction: importedModelProgress(plan, 'projector', fraction), fileName: mmProjFileName })
        : undefined,
    });
    llamaModel.mmProjPath = mmProjDestPath;
    llamaModel.mmProjFileName = mmProjFileName;
    llamaModel.mmProjFileSize = (await statFile(mmProjDestPath))?.size ?? 0;
    llamaModel.isVisionModel = true;
  }

  await persistDownloadedModel(llamaModel, modelsDir);
  return llamaModel;
}

import RNFS from 'react-native-fs';
import { mtpHeadForPrimaryFile, type MtpHeadFile } from '@offgrid/models';
import { makeModelKey } from '../utils/modelKey';
import { performSidecarDownload } from './modelManager/download';

/**
 * MTP heads published as a separate GGUF beside a model. Which head belongs to which model is the
 * shared catalog fact (@offgrid/models); this is the phone's IO: where the head lives (next to its
 * model, so deleting the model's folder takes it too), whether it is installed, and the download.
 */
export interface MtpHeadState {
  head: MtpHeadFile;
  localPath: string;
  installed: boolean;
}

function fileNameOf(path: string): string {
  return path.split('/').pop() ?? path;
}

function headPathFor(modelPath: string, head: MtpHeadFile): string {
  return `${modelPath.slice(0, modelPath.lastIndexOf('/'))}/${head.name}`;
}

/** The model's published MTP head and whether it is on disk, or null when it has none. */
export async function mtpHeadState(modelPath: string | undefined): Promise<MtpHeadState | null> {
  if (!modelPath) return null;
  const head = mtpHeadForPrimaryFile(fileNameOf(modelPath));
  if (!head) return null;
  const localPath = headPathFor(modelPath, head);
  return { head, localPath, installed: await RNFS.exists(localPath) };
}

/** The installed head's path for a load, or undefined when the model has none on disk. */
export async function installedMtpHeadPath(modelPath: string): Promise<string | undefined> {
  const state = await mtpHeadState(modelPath);
  return state?.installed ? state.localPath : undefined;
}

/** Download the model's MTP head beside it: progress on the model's row, resume, checksum. */
export async function downloadMtpHead(
  model: { id: string; fileName: string; filePath: string; quantization: string },
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const state = await mtpHeadState(model.filePath);
  if (!state) throw new Error('This model has no published MTP head');
  return performSidecarDownload({
    modelId: model.id,
    modelKey: makeModelKey(model.id, model.fileName),
    quantization: model.quantization,
    localPath: state.localPath,
    sidecar: { name: state.head.name, url: state.head.url, sizeBytes: state.head.sizeBytes, sha256: state.head.sha256 },
    onProgress: event => onProgress?.(event.progress),
  });
}

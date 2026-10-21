import RNFS from 'react-native-fs';
import { mtpHeadForPrimaryFile, type MtpHeadFile } from '@offgrid/models';

/**
 * MTP heads published as a separate GGUF beside a model. Which head belongs to which model is the
 * shared catalog fact (@offgrid/models); this is the phone's IO: where the head lives (next to its
 * model, so deleting the model's folder takes it too) and whether it is installed. The download is
 * in mtpHeadDownload, so loading a model never pulls in the download code.
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

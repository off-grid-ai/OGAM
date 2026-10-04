/**
 * Whisper model on-disk file management (paths, existence, validation, listing).
 *
 * Extracted from whisperService.ts (behavior-neutral) so the service file stays
 * within the max-lines budget. WhisperService's methods delegate to these free
 * functions; their signatures and behavior are unchanged.
 */
import RNFS from 'react-native-fs';
import { artifactVerificationError } from '@offgrid/models';
import logger from '../utils/logger';
import { artifactVerification } from './composition/artifact-verification';

/**
 * Minimum valid model file size in bytes (10 MB).
 * The smallest whisper model (tiny) is ~75 MB, so anything under 10 MB
 * is almost certainly a corrupted or incomplete download.
 */
export function getModelsDir(): string {
  return `${RNFS.DocumentDirectoryPath}/whisper-models`;
}

export async function ensureModelsDirExists(): Promise<void> {
  const dir = getModelsDir();
  if (!(await RNFS.exists(dir))) await RNFS.mkdir(dir);
}

export function getModelPath(modelId: string): string {
  return `${getModelsDir()}/ggml-${modelId}.bin`;
}

export async function isModelDownloaded(modelId: string): Promise<boolean> {
  return RNFS.exists(getModelPath(modelId));
}

/** List every downloaded ggml whisper model on disk (for the Download Manager). */
export async function listDownloadedModels(): Promise<
  Array<{
    modelId: string;
    fileName: string;
    sizeBytes: number;
    filePath: string;
  }>
> {
  const dir = getModelsDir();
  if (!(await RNFS.exists(dir))) return [];
  const entries = await RNFS.readDir(dir);
  const verified = await Promise.all(
    entries.map(async file => ({
      file,
      verification: await artifactVerification().verify({
        path: file.path,
        name: file.name,
        origin: 'inventory',
        removeInvalid: false,
      }),
    })),
  );
  return verified
    .filter(entry => entry.verification.valid && entry.verification.format === 'whisper')
    .map(({ file: f }) => ({
      modelId: f.name.replace(/^ggml-/, '').replace(/\.bin$/, ''),
      fileName: f.name,
      sizeBytes: Number(f.size) || 0,
      filePath: f.path,
    }));
}

/**
 * Validate that a whisper model file exists and has a reasonable size
 * before passing it to the native layer. The native initWithModelPath
 * calls abort() on invalid files, which kills the process without
 * giving JS a chance to handle the error.
 */
export async function validateModelFile(modelPath: string): Promise<void> {
  if (!modelPath) {
    throw new Error('Whisper model path is empty or undefined');
  }

  const request = {
    path: modelPath,
    name: modelPath.split('/').pop() || modelPath,
    format: 'whisper' as const,
    origin: 'runtime' as const,
  };
  const result = await artifactVerification().verify(request);
  if (!result.valid) {
    throw new Error(artifactVerificationError(request, result));
  }

  logger.log(
    `[Whisper] Model file validated: ${modelPath} (${Math.round(
      result.sizeBytes / (1024 * 1024),
    )} MB)`,
  );
}

/**
 * Admit a transferred Whisper artifact into the disk-backed transcription catalog.
 * The catalog identity and destination filename must agree before native code can see it.
 */
export async function registerTransferredModel(
  filePath: string,
  modelId: string,
): Promise<void> {
  if (
    !modelId ||
    modelId.includes('/') ||
    modelId.includes('\\') ||
    filePath !== getModelPath(modelId)
  ) {
    throw new Error('Transferred Whisper model identity is invalid');
  }
  await validateModelFile(filePath);
}

/**
 * Whisper model on-disk file management (paths, existence, validation, listing).
 *
 * Extracted from whisperService.ts (behavior-neutral) so the service file stays
 * within the max-lines budget. WhisperService's methods delegate to these free
 * functions; their signatures and behavior are unchanged.
 */
import RNFS from 'react-native-fs';
import logger from '../utils/logger';

/**
 * Minimum valid model file size in bytes (10 MB).
 * The smallest whisper model (tiny) is ~75 MB, so anything under 10 MB
 * is almost certainly a corrupted or incomplete download.
 */
const MIN_MODEL_FILE_SIZE = 10 * 1024 * 1024;

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
  Array<{ modelId: string; fileName: string; sizeBytes: number; filePath: string }>
> {
  const dir = getModelsDir();
  if (!(await RNFS.exists(dir))) return [];
  const entries = await RNFS.readDir(dir);
  return entries
    .filter(
      f =>
        f.isFile() &&
        f.name.startsWith('ggml-') &&
        f.name.endsWith('.bin') &&
        // Apply the same corrupt-file floor the load path uses: an app-kill
        // mid-download leaves a short ggml-<id>.bin at the final path (no .part),
        // which would otherwise be surfaced as "downloaded" and then fail to load
        // with no retry. Size gate here so the Download Manager never lists it.
        (Number(f.size) || 0) >= MIN_MODEL_FILE_SIZE,
    )
    .map(f => ({
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

  const exists = await RNFS.exists(modelPath);
  if (!exists) {
    throw new Error(`Whisper model file not found at: ${modelPath}`);
  }

  const stat = await RNFS.stat(modelPath);
  const fileSize = Number(stat.size);
  if (Number.isNaN(fileSize) || fileSize < MIN_MODEL_FILE_SIZE) {
    // Remove the corrupted file so the user can re-download
    await RNFS.unlink(modelPath).catch(() => {});
    throw new Error(
      `Whisper model file is too small (${Math.round(fileSize / 1024)} KB) and likely corrupted. ` +
      'The file has been removed. Please re-download the model.'
    );
  }

  logger.log(`[Whisper] Model file validated: ${modelPath} (${Math.round(fileSize / (1024 * 1024))} MB)`);
}

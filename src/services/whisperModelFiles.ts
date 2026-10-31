/**
 * Whisper model on-disk file management (paths, existence, validation, listing).
 *
 * Extracted from whisperService.ts (behavior-neutral) so the service file stays
 * within the max-lines budget. WhisperService's methods delegate to these free
 * functions; their signatures and behavior are unchanged.
 */
import RNFS from 'react-native-fs';
import { statFile } from '../utils/fileStat';
import logger from '../utils/logger';
import { qwenAsrFiles, QWEN_ASR_MODEL_ID, type QwenAsrFiles } from './qwenAsrModel';

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
  // A Qwen3-ASR model is its weights plus an audio projector; the weights path names it.
  const asr = qwenAsrFiles(modelId, getModelsDir());
  return asr ? asr.primary.path : `${getModelsDir()}/ggml-${modelId}.bin`;
}

/** Every file a transcription model keeps on disk. */
export function getModelFilePaths(modelId: string): string[] {
  const asr = qwenAsrFiles(modelId, getModelsDir());
  return asr ? [asr.primary.path, asr.mmproj.path] : [getModelPath(modelId)];
}

export async function isModelDownloaded(modelId: string): Promise<boolean> {
  const present = await Promise.all(getModelFilePaths(modelId).map(path => RNFS.exists(path)));
  return present.every(Boolean);
}

/** A Qwen3-ASR model's two files in the transcription models folder; undefined for a Whisper id. */
export function getQwenAsrFiles(modelId: string | null | undefined): QwenAsrFiles | undefined {
  return qwenAsrFiles(modelId, getModelsDir());
}

/** The Qwen3-ASR model whose weights live at this path, if any. */
export function getQwenAsrFilesForPath(modelPath: string): QwenAsrFiles | undefined {
  const files = getQwenAsrFiles(QWEN_ASR_MODEL_ID);
  return files?.primary.path === modelPath ? files : undefined;
}

/** A Qwen3-ASR model on disk when both of its files are there in full. */
async function downloadedQwenAsrModel(): Promise<
  { modelId: string; fileName: string; sizeBytes: number; filePath: string } | null
> {
  const files = getQwenAsrFiles(QWEN_ASR_MODEL_ID);
  if (!files) return null;
  const facts = await Promise.all([statFile(files.primary.path), statFile(files.mmproj.path)]);
  if (facts.some(fact => !fact || fact.size < MIN_MODEL_FILE_SIZE)) return null;
  return {
    modelId: QWEN_ASR_MODEL_ID,
    fileName: files.primary.name,
    sizeBytes: facts.reduce((sum, fact) => sum + (fact?.size ?? 0), 0),
    filePath: files.primary.path,
  };
}

/** Check a Qwen3-ASR model's two files before native code reads them. */
export async function validateQwenAsrFiles(files: QwenAsrFiles): Promise<void> {
  for (const file of [files.primary, files.mmproj]) {
    const facts = await statFile(file.path);
    if (!facts || facts.size < MIN_MODEL_FILE_SIZE) {
      throw new Error(`Qwen3-ASR model file not found or incomplete: ${file.name}`);
    }
  }
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
  const asr = await downloadedQwenAsrModel();
  const whisper = entries
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
  return asr ? [...whisper, asr] : whisper;
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

  const facts = await statFile(modelPath);
  if (!facts) {
    throw new Error(
      'Could not read Whisper model file metadata. Please try again.',
    );
  }
  const fileSize = facts.size;
  if (Number.isNaN(fileSize) || fileSize < MIN_MODEL_FILE_SIZE) {
    // Remove the corrupted file so the user can re-download
    await RNFS.unlink(modelPath).catch(() => {});
    throw new Error(
      `Whisper model file is too small (${Math.round(
        fileSize / 1024,
      )} KB) and likely corrupted. ` +
        'The file has been removed. Please re-download the model.',
    );
  }

  logger.log(
    `[Whisper] Model file validated: ${modelPath} (${Math.round(
      fileSize / (1024 * 1024),
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

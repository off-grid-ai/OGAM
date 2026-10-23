import { makeModelKey } from '../utils/modelKey';
import logger from '../utils/logger';
import { performSidecarDownload } from './modelManager/download';
import { mtpHeadState } from './mtpHeads';

type HeadModel = { id: string; fileName: string; filePath: string; quantization: string };

/** Download the model's MTP head beside it: progress on the model's row, resume, checksum. */
export async function downloadMtpHead(
  model: HeadModel,
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

const inFlight = new Set<string>();

/**
 * A model with a published MTP head gets it, with nothing to ask for: right after the model downloads,
 * and on a later load when it is still missing (a model from before this, or a failed download). A
 * model without one, or with it installed, starts nothing. The load drafts with the head once it is on
 * disk (mtpDetection).
 */
export async function ensureMtpHead(model: HeadModel): Promise<void> {
  if (inFlight.has(model.filePath)) return;
  const state = await mtpHeadState(model.filePath);
  if (!state || state.installed) return;
  inFlight.add(model.filePath);
  try {
    await downloadMtpHead(model);
  } catch (error) {
    logger.warn(`[MTP] head download for ${model.fileName} failed; the next load tries again`, error);
  } finally {
    inFlight.delete(model.filePath);
  }
}

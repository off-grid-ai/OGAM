import { makeModelKey } from '../utils/modelKey';
import { performSidecarDownload } from './modelManager/download';
import { mtpHeadState } from './mtpHeads';

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

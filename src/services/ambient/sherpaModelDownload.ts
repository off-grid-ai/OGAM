/**
 * Download + track the on-device diarization embedding models (the swappable part; the segmentation
 * model is bundled). The default bundle's embedding ships in the app, alternates download as a single
 * .onnx — like the Models screen downloads a model. The native module loads whichever path we pass.
 */
import RNFS from 'react-native-fs'
import { DEFAULT_DIARIZATION_MODEL_ID, type DiarizationModel } from '@offgrid/models'

const DIR = `${RNFS.CachesDirectoryPath}/sherpa-embeddings`

/** The default bundle's embedding is bundled in the app — nothing to download. */
export function isEmbeddingBundled(model: DiarizationModel): boolean {
  return model.id === DEFAULT_DIARIZATION_MODEL_ID
}

function localPath(model: DiarizationModel): string {
  return `${DIR}/${model.id}.onnx`
}

/** Ready to use (bundled, or already downloaded)? */
export async function isEmbeddingReady(model: DiarizationModel): Promise<boolean> {
  if (isEmbeddingBundled(model)) return true
  return RNFS.exists(localPath(model))
}

/** Local path to pass to the native module — undefined means "use the bundled default". */
export async function resolveEmbeddingPath(model: DiarizationModel): Promise<string | undefined> {
  if (isEmbeddingBundled(model)) return undefined
  return (await RNFS.exists(localPath(model))) ? localPath(model) : undefined
}

/** Download the alternate embedding .onnx, reporting 0..1 progress. No-op for the bundled default. */
export async function downloadEmbedding(
  model: DiarizationModel,
  onProgress?: (fraction: number) => void
): Promise<void> {
  if (isEmbeddingBundled(model)) return
  if (!(await RNFS.exists(DIR))) await RNFS.mkdir(DIR)
  const out = localPath(model)
  const { promise } = RNFS.downloadFile({
    fromUrl: model.embeddingUrl,
    toFile: out,
    progress: res => onProgress?.(res.contentLength > 0 ? res.bytesWritten / res.contentLength : 0),
    progressInterval: 300
  })
  const res = await promise
  if (res.statusCode && res.statusCode >= 400) {
    await RNFS.unlink(out).catch(() => undefined)
    throw new Error(`download failed (HTTP ${res.statusCode})`)
  }
}

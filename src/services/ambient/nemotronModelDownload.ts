/**
 * Download the on-device Nemotron diarizer (the stateless diarizeapp export) so the phone can run
 * diarization Mac-free. This pulls the SAME public model the Mac uses — the fp32 export from Hugging
 * Face, no custom hosting. It's an external-data ONNX (graph + a large .onnx.data beside it), so both
 * files must land in one directory with their original names for onnxruntime to resolve the data.
 *
 * On-device Nemotron is a fallback for when the Mac isn't reachable; most captures offload. So this is
 * an opt-in download (401 MB), gated by the Models screen like every other model.
 */
import RNFS from 'react-native-fs'
import { hfFileUrl, type DiarizationModel } from '@offgrid/models'
import { isEmbeddingReady, downloadEmbedding } from './sherpaModelDownload'

const DIR = `${RNFS.DocumentDirectoryPath}/nemotron-diarizer`

function modelDir(model: DiarizationModel): string {
  return `${DIR}/${model.id}`
}

/** Local path of the diarizer graph once installed (its .onnx.data sits beside it), or null. */
export async function nemotronModelPath(model: DiarizationModel): Promise<string | null> {
  if (!model.diarizer) return null
  const graph = `${modelDir(model)}/${basename(model.diarizer.onnx)}`
  const data = `${modelDir(model)}/${basename(model.diarizer.onnxData)}`
  return (await RNFS.exists(graph)) && (await RNFS.exists(data)) ? graph : null
}

export async function isNemotronInstalled(model: DiarizationModel): Promise<boolean> {
  return (await nemotronModelPath(model)) != null
}

/**
 * Download the diarizer graph + external data (+ config files) from Hugging Face. Best-effort resumable
 * per file; a failed file is removed so a retry re-fetches it cleanly. `onProgress` reports the combined
 * fraction across the (dominant) data file.
 */
export async function downloadNemotron(
  model: DiarizationModel,
  onProgress?: (fraction: number) => void
): Promise<void> {
  const art = model.diarizer
  if (!art) throw new Error('nemotron: model has no diarizer artifact')
  const dir = modelDir(model)
  if (!(await RNFS.exists(dir))) await RNFS.mkdir(dir)

  const files = [art.onnx, art.onnxData, ...(art.configFiles ?? [])]
  for (const file of files) {
    const out = `${dir}/${basename(file)}`
    if (await RNFS.exists(out)) continue
    const { promise } = RNFS.downloadFile({
      fromUrl: hfFileUrl(art.hfRepo, file),
      toFile: out,
      // The .onnx.data file is ~99% of the bytes, so surface only its progress as the bar.
      progress: res =>
        file === art.onnxData
          ? onProgress?.(res.contentLength > 0 ? res.bytesWritten / res.contentLength : 0)
          : undefined,
      progressInterval: 400
    })
    const res = await promise
    if (res.statusCode && res.statusCode >= 400) {
      await RNFS.unlink(out).catch(() => undefined)
      throw new Error(`nemotron download failed for ${basename(file)} (HTTP ${res.statusCode})`)
    }
  }
}

/** Forget the on-device model (storage control). */
export async function removeNemotron(model: DiarizationModel): Promise<void> {
  await RNFS.unlink(modelDir(model)).catch(() => undefined)
}

/**
 * Runtime-aware readiness for the Models screen: every diarizer needs its embedding (voiceprint) model,
 * and a Nemotron one ALSO needs its downloaded ONNX diarizer. One check the UI can call for any model.
 */
export async function isDiarizerReady(model: DiarizationModel): Promise<boolean> {
  const embReady = await isEmbeddingReady(model)
  if (model.runtime !== 'nemotron-onnx') return embReady
  return embReady && (await isNemotronInstalled(model))
}

/**
 * Download whatever a diarizer needs. Sherpa: just the embedding (progress is the whole thing).
 * Nemotron: the small embedding first, then the large ONNX diarizer (its download drives the progress
 * bar, since it's ~99% of the bytes).
 */
export async function downloadDiarizer(
  model: DiarizationModel,
  onProgress?: (fraction: number) => void
): Promise<void> {
  if (model.runtime === 'nemotron-onnx') {
    await downloadEmbedding(model)
    await downloadNemotron(model, onProgress)
  } else {
    await downloadEmbedding(model, onProgress)
  }
}

function basename(p: string): string {
  const i = p.lastIndexOf('/')
  return i >= 0 ? p.slice(i + 1) : p
}

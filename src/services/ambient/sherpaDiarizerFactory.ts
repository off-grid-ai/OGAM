/**
 * On-device diarizer via sherpa-onnx — one native pipeline that runs on BOTH iOS and Android.
 *
 * Bridges the native sherpa-onnx offline speaker-diarization API (pyannote segmentation + a speaker
 * embedding + clustering). Returns null when the native module or the model files aren't present, so
 * dispatchDiarize cleanly falls back to the Mac offload or to per-segment identification. The pure
 * naming/labelling in ./diarizationModel is engine-agnostic, so nothing downstream depends on sherpa.
 */
import { NativeModules } from 'react-native'
import type { DiarizationModel } from '@offgrid/models'
import { normalize } from './speakerModel'
import type { Diarizer, DiarizationResult } from './speakerDiarizer'

interface SherpaNativeTurn {
  startMs: number
  endMs: number
  cluster: string
  embedding?: number[]
}
interface SherpaDiarizationNative {
  /** Ensure the bundle's model files are downloaded/extracted; returns local paths. */
  prepare(model: { id: string; segmentationUrl: string; embeddingUrl: string }): Promise<{ ready: boolean }>
  diarize(input: { audioPath: string; modelId: string }): Promise<{ turns: SherpaNativeTurn[] }>
}

const native = NativeModules.SherpaOnnxDiarization as SherpaDiarizationNative | undefined

/** Whether on-device diarization is available on this build/device. */
export function sherpaDiarizationAvailable(): boolean {
  return !!native
}

/** Build an on-device diarizer for a bundle, or null when the native engine/models aren't present. */
export function createSherpaDiarizer(model: DiarizationModel): Diarizer | null {
  if (!native) return null
  return {
    diarize: async (recordingPath: string): Promise<DiarizationResult> => {
      await native.prepare({ id: model.id, segmentationUrl: model.segmentationUrl, embeddingUrl: model.embeddingUrl })
      const { turns } = await native.diarize({ audioPath: recordingPath, modelId: model.id })
      return {
        turns: turns.map(t => ({
          startMs: t.startMs,
          endMs: t.endMs,
          cluster: t.cluster,
          embedding: t.embedding && t.embedding.length > 0 ? normalize(t.embedding) : undefined
        }))
      }
    }
  }
}

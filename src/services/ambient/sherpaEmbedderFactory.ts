/**
 * On-device speaker embedder via sherpa-onnx — the enrollment/identity half of the offline path.
 *
 * Uses the SAME native module + embedding model as the sherpa diarizer, so an offline-enrolled voice
 * and the diarized turns live in one vector space (the alignment naming needs). Returns null when the
 * native module isn't present, so the engine resolver falls back to the ExecuTorch (.pte) embedder.
 */
import { NativeModules } from 'react-native'
import type { DiarizationModel } from '@offgrid/models'
import { normalize, type SpeakerEmbedding } from './speakerModel'
import { resolveEmbeddingPath } from './sherpaModelDownload'
import type { SpeakerEmbedder, SpeakerEmbedInput } from './speakerEmbedder'

interface SherpaEmbedNative {
  prepare(model: { id: string; segmentationUrl: string; embeddingUrl: string }): Promise<{ ready: boolean }>
  embed(input: { audioPath: string; modelId: string; embeddingPath?: string }): Promise<{ embedding: number[] }>
}
const native = NativeModules.SherpaOnnxDiarization as SherpaEmbedNative | undefined

/** Build an on-device sherpa embedder for a diarization bundle, or null when unavailable. */
export function createSherpaSpeakerEmbedder(model: DiarizationModel): SpeakerEmbedder | null {
  if (!native) return null
  return {
    dim: model.embeddingDim,
    async embed(input: SpeakerEmbedInput): Promise<SpeakerEmbedding> {
      const embeddingPath = await resolveEmbeddingPath(model)
      const { embedding } = await native.embed({ audioPath: input.slicePath, modelId: model.id, embeddingPath })
      if (!embedding || embedding.length === 0) throw new Error('sherpa returned no voiceprint')
      return normalize(embedding)
    }
  }
}

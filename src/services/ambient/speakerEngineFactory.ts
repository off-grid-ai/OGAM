/**
 * Resolve the active speaker engine, so enrollment and identification always share one embedding
 * space. Mac offload wins when reachable (pyannote diarizer + ECAPA embedder, cross-platform today);
 * otherwise the on-device ExecuTorch embedder for the selected catalog model (no diarizer yet).
 *
 * `modelId` tags enrolled profiles and scopes matching — the whole point is that whatever enrolled a
 * voice is the same engine that later identifies it.
 */
import { useSpeakerModelStore } from '../../stores/speakerModelStore'
import { createExecutorchSpeakerEmbedder } from './executorchSpeakerEmbedderFactory'
import { createMacSpeakerEmbedder, MAC_EMBED_MODEL_ID } from './macSpeakerEmbedderFactory'
import { createMacDiarizer } from './macDiarizerFactory'
import { createSherpaDiarizer } from './sherpaDiarizerFactory'
import type { SpeakerEmbedder } from './speakerEmbedder'
import type { Diarizer } from './speakerDiarizer'

export interface SpeakerEngine {
  /** Tags profiles + scopes matching so enroll and identify share a vector space. */
  modelId: string
  embedder: SpeakerEmbedder
  /** Present when the engine can diarize ("who spoke when"); absent → per-segment identification. */
  diarizer: Diarizer | null
}

export function resolveSpeakerEngine(): SpeakerEngine {
  const macEmbedder = createMacSpeakerEmbedder()
  if (macEmbedder) {
    return { modelId: MAC_EMBED_MODEL_ID, embedder: macEmbedder, diarizer: createMacDiarizer() }
  }
  const model = useSpeakerModelStore.getState().activeModel()
  return {
    modelId: model.id,
    embedder: createExecutorchSpeakerEmbedder(model),
    diarizer: createSherpaDiarizer(useSpeakerModelStore.getState().activeDiarizationModel())
  }
}

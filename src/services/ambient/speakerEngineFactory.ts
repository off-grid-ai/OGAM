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
import { createMacSpeakerEmbedder } from './macSpeakerEmbedderFactory'
import { createMacDiarizer } from './macDiarizerFactory'
import { createSherpaDiarizer } from './sherpaDiarizerFactory'
import { createSherpaSpeakerEmbedder } from './sherpaEmbedderFactory'
import type { SpeakerEmbedder } from './speakerEmbedder'
import type { Diarizer } from './speakerDiarizer'

export interface SpeakerEngine {
  /** Tags profiles + scopes matching so enroll and identify share a vector space. */
  modelId: string
  embedder: SpeakerEmbedder
  /** Present when the engine can diarize ("who spoke when"); absent → per-segment identification. */
  diarizer: Diarizer | null
}

/** The vector space a voice lives in, keyed by the FINGERPRINT model — not the engine. On-device
 *  sherpa and the Mac run the identical sherpa-onnx + model file, so their embeddings match; tagging by
 *  fingerprint (not by where it ran) lets one enrollment work on-device AND on the Mac, and lets a
 *  model switch re-embed the same voice everywhere. */
export function voiceSpaceId(fingerprintId: string): string {
  return `voice:${fingerprintId}`
}

export function resolveSpeakerEngine(): SpeakerEngine {
  // The phone's selected fingerprint is the single source of truth — it drives on-device AND what we
  // ask the Mac to run, so both sides always share one space.
  const diarModel = useSpeakerModelStore.getState().activeDiarizationModel()
  const modelId = voiceSpaceId(diarModel.id)

  // Mac offload wins when reachable; we tell it which fingerprint to run so its turns match `modelId`.
  const macEmbedder = createMacSpeakerEmbedder(diarModel)
  if (macEmbedder) {
    return { modelId, embedder: macEmbedder, diarizer: createMacDiarizer(diarModel) }
  }
  // On-device sherpa-onnx (offline diarize + embed, both platforms) — same space id as the Mac path.
  const sherpaEmbedder = createSherpaSpeakerEmbedder(diarModel)
  if (sherpaEmbedder) {
    return { modelId, embedder: sherpaEmbedder, diarizer: createSherpaDiarizer(diarModel) }
  }
  // Last resort: ExecuTorch (.pte) embedder for the selected catalog model (no on-device diarizer).
  const model = useSpeakerModelStore.getState().activeModel()
  return { modelId: model.id, embedder: createExecutorchSpeakerEmbedder(model), diarizer: null }
}

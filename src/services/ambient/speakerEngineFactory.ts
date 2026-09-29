/**
 * Resolve the active speaker engine, so enrollment and identification always share one embedding
 * space. Mac offload wins when reachable (pyannote diarizer + ECAPA embedder, cross-platform today);
 * otherwise the on-device ExecuTorch embedder for the selected catalog model (no diarizer yet).
 *
 * `modelId` tags enrolled profiles and scopes matching — the whole point is that whatever enrolled a
 * voice is the same engine that later identifies it.
 */
import {
  DIARIZATION_MODELS,
  DEFAULT_DIARIZATION_MODEL_ID,
  resolveDiarizationModel,
  type DiarizationModel,
} from '@offgrid/models'
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

/**
 * The voiceprint SPACE is defined by the embedding model, not the diarizer. Map any diarization model
 * to the id of the sherpa bundle that owns its embedding, so e.g. Nemotron (which uses CAM++ for
 * identity) and Pyannote+CAM++ share one space — a voice enrolled under either matches, and switching
 * between them (or between Mac-offload Nemotron and the on-device CAM++ fallback) needs no re-enroll.
 * For a sherpa model this returns its own id (unchanged), so existing enrollments keep their space id.
 */
function fingerprintKey(model: DiarizationModel): string {
  const owner = DIARIZATION_MODELS.find(
    m => m.runtime === 'sherpa-onnx' && m.embeddingUrl === model.embeddingUrl,
  )
  return owner?.id ?? model.id
}

/**
 * A phone-capable diarization model sharing `model`'s voiceprint space, for the on-device fallback when
 * the selected model can't run on the phone (desktop-only Nemotron with the Mac unreachable). Prefers a
 * mobile model with the same embedding; otherwise the default sherpa bundle.
 */
function onDeviceFallback(model: DiarizationModel): DiarizationModel {
  if (model.tiers.includes('mobile')) return model
  const shared = DIARIZATION_MODELS.find(
    m => m.tiers.includes('mobile') && m.embeddingUrl === model.embeddingUrl,
  )
  return shared ?? resolveDiarizationModel(DEFAULT_DIARIZATION_MODEL_ID)
}

export function resolveSpeakerEngine(): SpeakerEngine {
  // The phone's selected model is the single source of truth — it drives on-device AND what we ask the
  // Mac to run. The SPACE is keyed by the embedding so Mac + on-device always match.
  const diarModel = useSpeakerModelStore.getState().activeDiarizationModel()
  const modelId = voiceSpaceId(fingerprintKey(diarModel))

  // Mac offload wins when reachable; we tell it which model to run (e.g. Nemotron) via its id.
  const macEmbedder = createMacSpeakerEmbedder(diarModel)
  if (macEmbedder) {
    return { modelId, embedder: macEmbedder, diarizer: createMacDiarizer(diarModel) }
  }
  // On-device sherpa-onnx — fall back to a phone-capable model in the SAME space if the selected one is
  // desktop-only (Nemotron). Same space id as the Mac path so enrollment carries over.
  const onDevice = onDeviceFallback(diarModel)
  const sherpaEmbedder = createSherpaSpeakerEmbedder(onDevice)
  if (sherpaEmbedder) {
    return { modelId, embedder: sherpaEmbedder, diarizer: createSherpaDiarizer(onDevice) }
  }
  // Last resort: ExecuTorch (.pte) embedder for the selected catalog model (no on-device diarizer).
  const model = useSpeakerModelStore.getState().activeModel()
  return { modelId: model.id, embedder: createExecutorchSpeakerEmbedder(model), diarizer: null }
}

/**
 * Diarization seam — "who spoke when", cross-platform and engine-agnostic.
 *
 * A diarizer turns a whole recording into speaker TURNS: time spans each tagged with an anonymous
 * cluster ("spk0", "spk1", …) and, when the engine provides it, a voiceprint per turn. Identity
 * (putting a NAME on a cluster) is a separate, pure step in ./diarizationModel that reuses the enrolled
 * profiles — so the same matcher/enrollment/correction layer works no matter which engine ran.
 *
 * Two interchangeable engines plug in behind this: on-device sherpa-onnx (iOS + Android, one native
 * pipeline) and the Mac offload (pyannote Community-1 over the mesh). dispatchDiarize prefers the Mac
 * when asked, always falls back to on-device, and returns null when neither can run — the caller then
 * degrades to per-VAD-segment identification (speakerAnnotation).
 */
import RNFS from 'react-native-fs'
import type { SpeakerEmbedding } from './speakerModel'

export interface DiarizedTurn {
  startMs: number
  endMs: number
  /** Anonymous, engine-assigned cluster id, stable within one recording. */
  cluster: string
  /** Voiceprint for the turn, when the engine emits one (enables identity naming). */
  embedding?: SpeakerEmbedding
  /**
   * Near-field score in [0,1] (1 = in-scene, close mic), when the engine computes it. Feeds the
   * conversation-relevance gate; absent → that factor is simply excluded from the relevance score.
   */
  nearField?: number
}

export interface DiarizationResult {
  turns: DiarizedTurn[]
}

export interface Diarizer {
  /** Diarize a full recording. Throws if the engine can't run (triggers fallback). */
  diarize(recordingPath: string): Promise<DiarizationResult>
}

export type DiarizerName = 'phone' | 'mac'

export interface DiarizerDispatchDeps {
  /** On-device sherpa-onnx (both platforms). Absent when the model isn't installed. */
  phone?: Diarizer
  /** Mac offload (pyannote). Absent when the mesh is unreachable. */
  mac?: Diarizer
}

/** Diarize with Mac-first-when-asked, on-device fallback. Returns null if no engine could run. */
export async function dispatchDiarize(
  recordingPath: string,
  deps: DiarizerDispatchDeps,
  prefer: DiarizerName = 'phone'
): Promise<DiarizationResult | null> {
  // No engine can diarize a recording whose file is gone (pruned by retention, cleared, or never
  // finished writing). Bail before we hand a missing path to the Mac upload (which crashes React
  // Native's multipart builder natively) or the on-device runtime.
  const localPath = recordingPath.replace(/^file:\/\//, '')
  if (!(await RNFS.exists(localPath).catch(() => false))) return null
  const order: DiarizerName[] = prefer === 'mac' ? ['mac', 'phone'] : ['phone', 'mac']
  for (const name of order) {
    const engine = name === 'mac' ? deps.mac : deps.phone
    if (!engine) continue
    try {
      return await engine.diarize(recordingPath)
    } catch {
      // try the next engine
    }
  }
  return null
}

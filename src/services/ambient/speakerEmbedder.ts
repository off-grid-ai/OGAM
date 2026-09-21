/**
 * The voiceprint seam for speaker identification — one interface, interchangeable engines.
 *
 * Turns a speech slice into a fixed-length embedding (voiceprint). Concrete impls plug in later behind
 * this single interface so callers never branch on which one ran: on-device via ExecuTorch (the
 * default, zero network), and a Mac-offload variant over the mesh (bigger model), mirroring how STT
 * splits phone/mac. The pure matching policy lives in ./speakerModel; this is only the "audio → vector"
 * step. Native-free at this layer so the enrollment and identify flows can be tested with a fake that
 * returns deterministic vectors.
 */
import type { SpeakerEmbedding } from './speakerModel'

export interface SpeakerEmbedInput {
  /** WAV/PCM slice on disk to fingerprint — typically one VAD segment. */
  slicePath: string
}

export interface SpeakerEmbedder {
  /** Dimensionality of the vectors this engine emits (e.g. 192 for ECAPA-TDNN). */
  readonly dim: number
  /** Compute a normalized voiceprint for the slice. Throws if the engine can't run (triggers fallback). */
  embed(input: SpeakerEmbedInput): Promise<SpeakerEmbedding>
}

export type SpeakerEmbedderName = 'phone' | 'mac'

export interface SpeakerEmbedDispatchDeps {
  phone: SpeakerEmbedder
  /** Present only while the Mac is reachable over the mesh. Absent = phone-only. */
  mac?: SpeakerEmbedder
}

export type SpeakerEmbedResult =
  | { ok: true; embedding: SpeakerEmbedding; embedder: SpeakerEmbedderName }
  | { ok: false; error: string }

/**
 * Compute a voiceprint, Mac-first when asked, then always the phone as the safety net — so a dropped
 * mesh mid-run degrades to on-device instead of losing the segment. Mirrors dispatchStt exactly.
 */
export async function dispatchSpeakerEmbed(
  input: SpeakerEmbedInput,
  deps: SpeakerEmbedDispatchDeps,
  prefer: SpeakerEmbedderName = 'phone'
): Promise<SpeakerEmbedResult> {
  const order: SpeakerEmbedderName[] = prefer === 'mac' ? ['mac', 'phone'] : ['phone']
  let lastError = 'no embedding backend available'
  for (const name of order) {
    const embedder = name === 'mac' ? deps.mac : deps.phone
    if (!embedder) {
      lastError = `${name} embedding backend unavailable`
      continue
    }
    try {
      const embedding = await embedder.embed(input)
      return { ok: true, embedding, embedder: name }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  return { ok: false, error: lastError }
}

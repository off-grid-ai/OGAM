/**
 * Turn a captured segment's existing audio into a voiceprint — so the user can assign an unknown
 * speaker straight from the timeline instead of re-recording. Slices the segment out of the recording
 * and embeds it through the active engine (the same one diarization used), returning the vector plus
 * the engine's modelId so the profile is tagged in the right vector space. Best-effort → null on any
 * failure (e.g. the recording was aged out of retention).
 */
import RNFS from 'react-native-fs'
import { extractWavSegment } from '../wavSlicer'
import { resolveSpeakerEngine } from './speakerEngineFactory'
import type { SpeakerEmbedding } from './speakerModel'

const DIR = `${RNFS.CachesDirectoryPath}/ambient-assign`

export async function embedSessionSegment(
  recordingPath: string,
  startMs: number,
  endMs: number
): Promise<{ embedding: SpeakerEmbedding; modelId: string } | null> {
  try {
    if (!(await RNFS.exists(DIR))) await RNFS.mkdir(DIR)
    const out = `${DIR}/${startMs}-${endMs}.wav`
    if (!(await extractWavSegment(recordingPath, startMs, endMs, out))) return null
    const engine = resolveSpeakerEngine()
    const embedding = await engine.embedder.embed({ slicePath: out })
    if (!embedding || embedding.length === 0) return null
    return { embedding, modelId: engine.modelId }
  } catch {
    return null
  }
}

/** The active engine's model id — what enrolled profiles must be tagged with to be comparable. */
export function activeEngineModelId(): string {
  return resolveSpeakerEngine().modelId
}

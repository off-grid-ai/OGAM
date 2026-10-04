/**
 * On-device Nemotron diarizer — runs the stateless NVIDIA Nemotron-3 ONNX export on the phone via
 * onnxruntime-react-native, so diarization works when the Mac isn't reachable. Mirrors the desktop's
 * `nemotronDiarize` exactly, reusing the SHARED pure pipeline so both platforms behave identically:
 *
 *   chunk 10s windows → run ONNX (speaker_probs) → nemotronTurnsFromProbs → embed each turn (CAM++)
 *   → assignGlobalClusters (Nemotron is stateless, so chunk-local speakers must be re-aligned globally)
 *   → nearFieldForTurns (relevance-gate input).
 *
 * Returns null when onnxruntime isn't linked in this build or the model isn't installed, so
 * dispatchDiarize cleanly falls back (sherpa on-device, or the Mac). Identity still needs a voiceprint
 * model — the caller passes the same embedder resolveSpeakerEngine picked, so turns land in one space.
 */
import RNFS from 'react-native-fs'
import {
  nemotronTurnsFromProbs,
  assignGlobalClusters,
  nearFieldForTurns,
  type DiarizationModel
} from '@offgrid/models'
import { InferenceSession, Tensor } from 'onnxruntime-react-native'
import { readWavPcm } from './wavDecode'
import { writeSegmentWav } from './livePcmWav'
import { normalize } from './speakerModel'
import { nemotronModelPath } from './nemotronModelDownload'
import type { SpeakerEmbedder } from './speakerEmbedder'
import type { Diarizer, DiarizationResult, DiarizedTurn } from './speakerDiarizer'

const TARGET_SR = 16000
const NEMOTRON_WIN = 160000 // fixed 10s input window (this export is stateless, one window at a time)
const MIN_EMBED_SAMPLES = 4000 // ~0.25s — skip sub-blip turns, matching the desktop/py path

// Cache one session per model path; loading a 400 MB graph is expensive.
let cached: { path: string; session: InferenceSession } | null = null
async function getSession(path: string): Promise<InferenceSession> {
  if (cached && cached.path === path) return cached.session
  const session = await InferenceSession.create(path)
  cached = { path, session }
  return session
}

/**
 * Free the loaded diarizer from memory. The on-device pipeline is strictly one-model-at-a-time (whisper
 * → diarizer → text LLM); this is the diarizer's eviction, called after diarization so the text model
 * has room. Without it a 400 MB session lingers into the summary phase and blows RAM on the phone.
 */
export async function releaseNemotronSession(): Promise<void> {
  const session = cached?.session
  cached = null
  try {
    await (session as unknown as { release?: () => Promise<void> })?.release?.()
  } catch {
    // best-effort — dropping the reference lets it be collected even if release throws
  }
}

/** Whether onnxruntime-react-native is linked into this build (native module present). */
export function nemotronRuntimeAvailable(): boolean {
  try {
    return typeof InferenceSession?.create === 'function'
  } catch {
    return false
  }
}

/**
 * On-device Nemotron diarizer for `model`, or null when the runtime/model aren't ready. `embedder` is
 * the active voiceprint model (CAM++), used to embed each turn for global speaker clustering.
 */
export function createNemotronDiarizer(model: DiarizationModel, embedder: SpeakerEmbedder): Diarizer | null {
  if (model.runtime !== 'nemotron-onnx' || !nemotronRuntimeAvailable()) return null
  return {
    diarize: async (recordingPath: string): Promise<DiarizationResult> => {
      const onnxPath = await nemotronModelPath(model)
      if (!onnxPath) throw new Error('nemotron: on-device model not installed')
      const localPath = recordingPath.replace(/^file:\/\//, '')
      if (!(await RNFS.exists(localPath))) {
        throw new Error(`nemotron: recording file is missing (${localPath})`)
      }

      const { samples } = await readWavPcm(localPath)
      const session = await getSession(onnxPath)

      const tmpDir = `${RNFS.CachesDirectoryPath}/nemotron-turns`
      if (!(await RNFS.exists(tmpDir))) await RNFS.mkdir(tmpDir)

      // Per chunk: infer → valid frames → local turns → CAM++ voiceprint per turn (via a temp WAV, since
      // the embedder takes a file). Times are made global by adding the chunk offset.
      const pending: { startMs: number; endMs: number; embedding?: number[] }[] = []
      for (let off = 0; off < samples.length; off += NEMOTRON_WIN) {
        const chunk = samples.subarray(off, off + NEMOTRON_WIN)
        const padded =
          chunk.length === NEMOTRON_WIN
            ? Float32Array.from(chunk)
            : (() => {
                const p = new Float32Array(NEMOTRON_WIN)
                p.set(chunk)
                return p
              })()
        const out = await session.run({
          input_signal: new Tensor('float32', padded, [1, NEMOTRON_WIN]),
          input_signal_length: new Tensor('int64', BigInt64Array.from([BigInt(chunk.length)]), [1])
        })
        const probsT = (out.speaker_probs ?? Object.values(out)[0]) as { dims: readonly number[]; data: Float32Array }
        const dims = probsT.dims
        const T = (dims.length >= 3 ? dims[dims.length - 2] : dims[0]) ?? 0
        const stride = dims[dims.length - 1] ?? 0
        if (T <= 0 || stride <= 0) continue
        const samplesPerFrame = NEMOTRON_WIN / T
        const validFrames = Math.max(1, Math.floor(chunk.length / samplesPerFrame))
        const valid = probsT.data.subarray(0, validFrames * stride)
        const chunkMs = (chunk.length / TARGET_SR) * 1000
        const offMs = (off / TARGET_SR) * 1000

        for (const t of nemotronTurnsFromProbs(valid, validFrames, stride, chunkMs)) {
          const s0 = off + Math.floor((t.startMs / 1000) * TARGET_SR)
          const s1 = off + Math.floor((t.endMs / 1000) * TARGET_SR)
          const seg = samples.subarray(Math.max(0, s0), Math.min(samples.length, s1))
          let embedding: number[] | undefined
          if (seg.length >= MIN_EMBED_SAMPLES) {
            const wavPath = `${tmpDir}/turn-${off}-${Math.round(t.startMs)}.wav`
            try {
              await writeSegmentWav(Float32Array.from(seg), TARGET_SR, wavPath)
              const e = await embedder.embed({ slicePath: wavPath })
              if (e.length > 0) embedding = Array.from(normalize(e))
            } catch {
              // an unembeddable turn just clusters as its own speaker
            } finally {
              await RNFS.unlink(wavPath).catch(() => undefined)
            }
          }
          pending.push({ startMs: t.startMs + offMs, endMs: t.endMs + offMs, embedding })
        }
      }

      // Nemotron is stateless: a chunk's local spk0 is not the next chunk's, so re-align speakers globally
      // by clustering the voiceprints (shared with the desktop, one tested implementation).
      const labels = assignGlobalClusters(pending.map(p => p.embedding))
      const turns: DiarizedTurn[] = pending
        .map((p, i) => ({
          startMs: Math.round(p.startMs),
          endMs: Math.round(p.endMs),
          cluster: `spk${labels[i]}`,
          embedding: p.embedding
        }))
        .sort((a, b) => a.startMs - b.startMs)

      const nf = nearFieldForTurns(samples, turns, { sampleRate: TARGET_SR })
      turns.forEach((t, i) => {
        t.nearField = nf[i]
      })
      return { turns }
    }
  }
}

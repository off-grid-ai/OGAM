/**
 * On-device rolling-window live transcriber — the local equivalent of the Mac streaming session.
 *
 * The VAD only closes a phrase on a real silence, so a short continuous utterance is one segment that
 * only settles at stop — nothing shows live. This instead re-decodes the GROWING utterance on a timer
 * (the whisper.cpp `stream` pattern) so words appear ~1.5s behind speech, then finalizes on flush.
 * Reuses the same SttExecutor (on-device whisper) + WAV encoder the batch/per-segment paths use.
 *
 * Cost: it runs whisper repeatedly while recording, so it's a foreground-recording feature, not for
 * 24/7 background capture. One decode in flight at a time; the window resets per phrase (flush) so it
 * can't grow unbounded.
 */
import RNFS from 'react-native-fs'
import { writeSegmentWav } from './livePcmWav'
import type { SttExecutor } from './sttExecutor'

const PARTIAL_INTERVAL_MS = 1500
const DIR = `${RNFS.CachesDirectoryPath}/ambient-rolling`

export interface LocalRollingTranscriber {
  pushFrame(pcm: Float32Array, sampleRate: number): void
  /** Phrase boundary: finalize what's buffered, then start the next phrase fresh. */
  flush(): void
  stop(): void
}

function concat(chunks: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

export function createLocalRollingTranscriber(opts: {
  executor: SttExecutor
  onPartial: (text: string) => void
  onFinal: (text: string) => void
}): LocalRollingTranscriber {
  let chunks: Float32Array[] = []
  let samples = 0
  let rate = 16000
  let busy = false
  let dirty = false
  let closed = false
  let seq = 0

  const decode = async (final: boolean): Promise<void> => {
    if (closed) return
    if (busy) {
      dirty = true
      return
    }
    if (samples === 0) {
      if (final) opts.onFinal('')
      return
    }
    busy = true
    dirty = false
    const pcm = concat(chunks, samples)
    const path = `${DIR}/roll-${(seq += 1)}.wav`
    try {
      await RNFS.mkdir(DIR).catch(() => undefined)
      await writeSegmentWav(pcm, rate, path)
      const { text } = await opts.executor.transcribe({
        segmentId: `roll-${seq}`,
        recordingPath: path,
        startMs: 0,
        endMs: Math.round((samples / rate) * 1000)
      })
      if (!closed) (final ? opts.onFinal : opts.onPartial)(text)
    } catch {
      // A dropped partial is fine; the next tick (or the batch pass at stop) recovers.
    } finally {
      await RNFS.unlink(path).catch(() => undefined)
      busy = false
      if (!closed && dirty && !final) void decode(false)
    }
  }

  const timer = setInterval(() => {
    if (dirty && !busy) void decode(false)
  }, PARTIAL_INTERVAL_MS)

  return {
    pushFrame(pcm: Float32Array, sampleRate: number): void {
      if (closed || pcm.length === 0) return
      rate = sampleRate
      chunks.push(pcm)
      samples += pcm.length
      dirty = true
    },
    flush(): void {
      void decode(true).then(() => {
        chunks = []
        samples = 0
        dirty = false
      })
    },
    stop(): void {
      closed = true
      clearInterval(timer)
      chunks = []
      samples = 0
    }
  }
}

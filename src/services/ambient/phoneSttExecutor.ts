/**
 * On-device whisper as an SttExecutor — the phone leg of the STT dispatch seam.
 *
 * A pending segment is a [startMs, endMs) window inside the long rolling capture file. To transcribe
 * it we slice that span into a standalone WAV, hand it to on-device whisper, and delete the slice. The
 * Mac-offload executor implements the SAME interface, so the dispatcher (sttExecutor.ts) treats the
 * two as interchangeable and the Mac stays an accelerator, never a hard dependency.
 *
 * The composition is deps-injected (slice, transcribe, temp path, cleanup) so it is unit-testable with
 * fakes; the concrete wiring to extractWavSegment + whisperService lives in the factory at the bottom.
 * The temp slice is ALWAYS cleaned up, even when transcription throws - a 24/7 recorder that leaked a
 * WAV per segment would fill the disk in a day.
 */

import type { SttExecutor, SttInput } from './sttExecutor'

export interface PhoneSttDeps {
  /** Cut [startMs,endMs) out of the source recording into `outPath`; false if nothing landed there. */
  extractSegment: (
    sourcePath: string,
    startMs: number,
    endMs: number,
    outPath: string
  ) => Promise<boolean>
  /** Transcribe a standalone WAV file on-device. */
  transcribe: (filePath: string, options?: { language?: string }) => Promise<string>
  /** Where to write the throwaway slice for a segment. */
  tempPath: (segmentId: string) => string
  /** Remove the throwaway slice. */
  cleanup: (path: string) => Promise<void>
  /** Whisper language hint (undefined = auto). */
  language?: string
}

export function createPhoneSttExecutor(deps: PhoneSttDeps): SttExecutor {
  return {
    transcribe: async (input: SttInput): Promise<{ text: string }> => {
      const slicePath = deps.tempPath(input.segmentId)
      const sliced = await deps.extractSegment(
        input.recordingPath,
        input.startMs,
        input.endMs,
        slicePath
      )
      if (!sliced) {
        throw new Error(`ambient: could not extract audio for segment ${input.segmentId}`)
      }
      try {
        const text = await deps.transcribe(slicePath, { language: deps.language })
        return { text }
      } finally {
        await deps.cleanup(slicePath).catch(() => undefined)
      }
    }
  }
}

/**
 * One capture's worth of transcription: take the speech segments a finished recording produced, load
 * them into a store, run a single transcription pass, and hand back the resulting records for display.
 *
 * This is the join between the capture side (AmbientRecorder emits SpeechSegments + a recording file)
 * and the transcription side (store + runner + executor). Pulled out of the screen so it is testable
 * without a component and reused when the background task runs the same pass on a schedule. It owns no
 * policy - the scheduler decides what runs, the executor does the work; this only wires one pass.
 */

import { InMemoryAmbientStore, segmentId, type AmbientSegmentRecord } from './ambientStore'
import { runTranscriptionPass } from './transcriptionRunner'
import type { DeviceConditions, SttSchedulerConfig } from './sttScheduler'
import type { SttDispatchDeps, SttExecutor } from './sttExecutor'
import type { SpeechSegment } from './vadSegmenter'

export interface TranscribeCaptureDeps {
  segments: SpeechSegment[]
  recordingPath: string
  executors: SttDispatchDeps
  /** Live device state; defaults to a healthy, plugged-in phone so a manual run always proceeds. */
  device?: DeviceConditions
  config?: SttSchedulerConfig
}

const MANUAL_RUN_DEVICE: DeviceConditions = {
  batteryLevel: 1,
  charging: true,
  macReachable: false
}

/**
 * Transcribe the segments of one finished capture and return every record, oldest first (transcribed
 * or still pending). A manual run defaults to healthy device conditions so the scheduler never defers
 * it; the background task passes real conditions instead.
 */
export async function transcribeCapturedSegments(
  deps: TranscribeCaptureDeps
): Promise<AmbientSegmentRecord[]> {
  const store = new InMemoryAmbientStore()
  for (const segment of deps.segments) store.add(segment, deps.recordingPath)
  await runTranscriptionPass({
    store,
    device: async () => deps.device ?? MANUAL_RUN_DEVICE,
    executors: () => deps.executors,
    config: deps.config
  })
  return store.snapshot()
}

/**
 * Probe-only: transcribe each segment directly and report per-segment outcome INCLUDING the failure
 * reason. The production path (transcribeCapturedSegments) goes through the scheduler + store, which
 * deliberately swallow a failure into a retry count - right for a background pass, wrong for a device
 * probe where the whole point is to see WHY a segment produced no text (empty slice, whisper error,
 * missing recording). Bypasses the scheduler so nothing is deferred; the executor still owns slice +
 * whisper + cleanup.
 */
export interface ProbeSegmentResult {
  id: string
  startMs: number
  endMs: number
  transcript: string | null
  error: string | null
}

export async function probeTranscribeSegments(
  segments: SpeechSegment[],
  recordingPath: string,
  executor: SttExecutor
): Promise<ProbeSegmentResult[]> {
  const results: ProbeSegmentResult[] = []
  for (const segment of segments) {
    const id = segmentId(segment)
    try {
      const { text } = await executor.transcribe({
        segmentId: id,
        recordingPath,
        startMs: segment.startMs,
        endMs: segment.endMs
      })
      const trimmed = text.trim()
      results.push({
        id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        transcript: trimmed.length > 0 ? trimmed : null,
        error: trimmed.length > 0 ? null : 'Transcribed to empty text (silence or too short?)'
      })
    } catch (e) {
      results.push({
        id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        transcript: null,
        error: e instanceof Error ? e.message : 'Transcription failed'
      })
    }
  }
  return results
}

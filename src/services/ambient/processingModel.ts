/**
 * When the recorder does its heavy work - the lead's configurable "real-time vs batched" choice.
 *
 * Live: transcribe + summarise the moment you stop, so the day fills in immediately (best plugged in).
 * Nightly: queue the capture and process it in a later batch, so recording stays cheap on battery and
 * the Day is ready when you come back. Same pipeline; only WHEN it runs changes.
 *
 * Pure: the mode + the queued-capture shape. The screen owns the queue + the "process now" trigger.
 */

import type { SpeechSegment } from './vadSegmenter'

export type ProcessingMode = 'live' | 'nightly'

export const DEFAULT_PROCESSING_MODE: ProcessingMode = 'live'

/** A finished capture waiting to be transcribed + summarised (nightly/deferred mode). */
export interface PendingCapture {
  id: string
  segments: SpeechSegment[]
  recordingPath: string
  captureStartedAtMs: number
  anchorsMs: number[]
}

/** Whether to process immediately on stop, or queue it for a later pass. */
export function processOnStop(mode: ProcessingMode): boolean {
  return mode === 'live'
}

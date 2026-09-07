/**
 * The captured-segment store — the source of truth for "what has been heard and what has been
 * transcribed". The transcription runner reads pending segments from it, writes transcripts back, and
 * bumps attempt counts here; the timeline UI reads the same records. One store, both readers, so a
 * transcript and its segment can never disagree.
 *
 * This is the in-memory implementation for the first device pass. It satisfies AmbientSegmentStore
 * (what the runner depends on) plus the capture-side `add` and the read-side `snapshot` the UI needs.
 * The persistent implementation (SQLite + the rolling capture file) drops in behind the SAME interface
 * later - the runner and the UI do not change when it does.
 */

import type { AmbientSegmentStore } from './transcriptionRunner'
import type { SttInput } from './sttExecutor'
import type { PendingSegment } from './sttScheduler'
import type { SpeechSegment } from './vadSegmenter'

export interface AmbientSegmentRecord {
  id: string
  startMs: number
  endMs: number
  /** The capture file this span lives inside. */
  recordingPath: string
  attempts: number
  /** Null until transcribed; the transcript text once whisper has run. */
  transcript: string | null
  flagged?: boolean
}

/** A segment id is its span - stable, unique within one capture, and needs no counter. */
export function segmentId(segment: SpeechSegment): string {
  return `${segment.startMs}-${segment.endMs}`
}

export class InMemoryAmbientStore implements AmbientSegmentStore {
  private readonly records = new Map<string, AmbientSegmentRecord>()

  /** Record a freshly detected speech span. Idempotent on its span id. */
  add(segment: SpeechSegment, recordingPath: string): AmbientSegmentRecord {
    const id = segmentId(segment)
    const existing = this.records.get(id)
    if (existing) return existing
    const record: AmbientSegmentRecord = {
      id,
      startMs: segment.startMs,
      endMs: segment.endMs,
      recordingPath,
      attempts: 0,
      transcript: null
    }
    this.records.set(id, record)
    return record
  }

  async pending(): Promise<PendingSegment[]> {
    return this.snapshot()
      .filter(record => record.transcript === null)
      .map(record => ({
        id: record.id,
        startMs: record.startMs,
        attempts: record.attempts,
        flagged: record.flagged
      }))
  }

  async input(segmentId: string): Promise<SttInput | null> {
    const record = this.records.get(segmentId)
    if (!record) return null
    return {
      segmentId: record.id,
      recordingPath: record.recordingPath,
      startMs: record.startMs,
      endMs: record.endMs
    }
  }

  async saveTranscript(segmentId: string, text: string): Promise<void> {
    const record = this.records.get(segmentId)
    if (record) record.transcript = text
  }

  async markAttempt(segmentId: string): Promise<void> {
    const record = this.records.get(segmentId)
    if (record) record.attempts += 1
  }

  /** Every record, oldest first — what the timeline renders. */
  snapshot(): AmbientSegmentRecord[] {
    return [...this.records.values()].sort((a, b) => a.startMs - b.startMs)
  }
}

/**
 * Preparing a conversation's audio for Replay.
 *
 * A conversation lives inside the day's capture file at a byte offset. Its position = its absolute
 * time minus when the capture started, both of which we persist on the session. This carves that span
 * out into a standalone clip the player can open, reusing the same WAV slicer the STT path uses.
 *
 * PURE composition over an injected extractor, so the offset math is testable without touching a file.
 */

import type { TimelineSession } from './timelineModel'

export interface ReplaySource {
  recordingPath: string
  /** Absolute epoch ms of the conversation span. */
  startMs: number
  endMs: number
  /** Absolute epoch ms the capture began - the origin for offsets into the file. */
  captureStartedAtMs: number
}

export interface ReplayDeps {
  extractSegment: (
    sourcePath: string,
    startMs: number,
    endMs: number,
    outPath: string
  ) => Promise<boolean>
  outPath: (key: string) => string
}

/** A replay source from a session, or null when the record predates audio retention. */
export function replaySourceForSession(session: TimelineSession): ReplaySource | null {
  if (!session.recordingPath || session.captureStartedAtMs === undefined) return null
  return {
    recordingPath: session.recordingPath,
    startMs: session.startMs,
    endMs: session.endMs,
    captureStartedAtMs: session.captureStartedAtMs
  }
}

/** Carve the conversation's span out of the capture into a clip; returns its path, or null on failure. */
export async function prepareReplayClip(
  source: ReplaySource,
  deps: ReplayDeps
): Promise<string | null> {
  const relStart = Math.max(0, source.startMs - source.captureStartedAtMs)
  const relEnd = Math.max(relStart, source.endMs - source.captureStartedAtMs)
  const out = deps.outPath(`${source.startMs}-${source.endMs}`)
  const ok = await deps.extractSegment(source.recordingPath, relStart, relEnd, out)
  return ok ? out : null
}

/**
 * Automatic speaker labelling for finalized sessions — "extract the voice from context and match it".
 *
 * For each transcribed segment we slice its span out of the capture, embed it through the active
 * model, and match it against the enrolled profiles, writing the result back via setSpeaker. Pure over
 * injected deps (slice/embed/setSpeaker) so it's unit-testable, and best-effort per segment: any
 * failure (no model, bad slice) is skipped, never thrown — identification must never disturb capture.
 * Unknown/low-confidence segments are labelled null, which the timeline shows as "Unknown voice" for
 * the user to correct (Phase 5).
 */
import { matchSpeaker, DEFAULT_MATCH_THRESHOLD, type SpeakerEmbedding, type SpeakerProfile } from './speakerModel'

export interface AnnotatableSegment {
  id: string
  /** Offset into the recording (ms), relative to capture start. */
  startMs: number
  endMs: number
  transcript: string | null
}

export interface AnnotatableSession {
  id: string
  recordingPath?: string
  segments: AnnotatableSegment[]
}

export interface AnnotationDeps {
  /** Carve [startMs,endMs] out of the recording into a WAV; null on failure. */
  slice(recordingPath: string, startMs: number, endMs: number): Promise<string | null>
  embed(slicePath: string): Promise<SpeakerEmbedding>
  profiles: SpeakerProfile[]
  threshold?: number
  setSpeaker(sessionId: string, segmentId: string, speakerId: string | null, speakerName: string | null): void
}

/** Label every transcribed segment across `sessions`. Returns how many got a confident speaker. */
export async function annotateSessions(
  sessions: AnnotatableSession[],
  deps: AnnotationDeps
): Promise<number> {
  if (deps.profiles.length === 0) return 0
  const threshold = deps.threshold ?? DEFAULT_MATCH_THRESHOLD
  let labelled = 0
  for (const session of sessions) {
    if (!session.recordingPath) continue
    for (const seg of session.segments) {
      if (!seg.transcript) continue
      try {
        const slicePath = await deps.slice(session.recordingPath, seg.startMs, seg.endMs)
        if (!slicePath) continue
        const embedding = await deps.embed(slicePath)
        if (!embedding || embedding.length === 0) continue
        const match = matchSpeaker(embedding, deps.profiles, threshold)
        deps.setSpeaker(session.id, seg.id, match.speakerId, match.name)
        if (match.speakerId) labelled += 1
      } catch {
        // Best-effort per segment — a failure here must not sink the session.
      }
    }
  }
  return labelled
}

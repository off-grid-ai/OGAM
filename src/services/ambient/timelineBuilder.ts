/**
 * Turn one finished capture into timeline sessions.
 *
 * The join across everything built so far: sessionize the raw segments into conversations, transcribe
 * each segment, stitch a session's segments into a transcript, summarise it, and stamp absolute
 * wall-clock times (capture offsets + the capture's start epoch). Output goes straight into the
 * timeline store.
 *
 * TWO RESIDENCY PHASES on purpose. On a phone the whisper model and the text LLM are mutually
 * exclusive in memory - loading one evicts the other - so this transcribes EVERY segment first (whisper
 * resident), then hands off (prepareForSummaries loads the text model, evicting whisper), then
 * summarises EVERY session (text LLM resident). Interleaving per session thrashed the two engines and
 * left the text model evicted at summary time, which is why cards read "load a chat model" when one was
 * loaded.
 *
 * Deps-injected (transcribe executor, summarise fn, the residency hand-off) so the whole pipeline is
 * unit-testable with fakes and nothing here is bound to whisper or the LLM. A segment that fails to
 * transcribe contributes no text but still appears (with its error) under the session, so the card is
 * honest about what was and was not heard.
 */

import { sessionizeSegments, type SessionizerConfig } from './sessionizer'
import { probeTranscribeSegments } from './ambientCaptureSession'
import { flagSegmentsForAnchors } from './anchors'
import type { SttExecutor } from './sttExecutor'
import type { SpeechSegment } from './vadSegmenter'
import type { SummarizeResult } from './summarizer'
import type { TimelineSession, TimelineSegment } from './timelineModel'

/** Coarse progress for the UI, so a long capture is not an opaque wait. */
export type BuildProgress =
  | { phase: 'transcribing'; done: number; total: number }
  | { phase: 'loading-model' }
  | { phase: 'summarizing'; done: number; total: number }

export interface TimelineBuildDeps {
  executor: SttExecutor
  summarize: (transcript: string, flaggedSnippets: string[]) => Promise<SummarizeResult>
  /**
   * Called ONCE after all transcription and before any summary, to make the text model resident
   * (evicting whisper if the device can only hold one). Optional so tests need not supply it.
   */
  prepareForSummaries?: () => Promise<void>
  /** Progress ticks for the UI (transcribing -> loading-model -> summarizing). Optional. */
  onProgress?: (progress: BuildProgress) => void
  sessionizerConfig?: SessionizerConfig
}

interface TranscribedSession {
  sessionStartMs: number
  sessionEndMs: number
  sessionId: string
  speechMs: number
  transcript: string
  flaggedSegmentIds: string[]
  flaggedSnippets: string[]
  segments: TimelineSegment[]
}

export async function buildTimelineSessions(
  segments: SpeechSegment[],
  recordingPath: string,
  captureStartedAtMs: number,
  deps: TimelineBuildDeps,
  /** Live-flag times, relative to capture start (note-first anchoring). */
  anchorsMs: number[] = []
): Promise<TimelineSession[]> {
  const sessions = sessionizeSegments(segments, deps.sessionizerConfig)
  if (sessions.length === 0) return []

  // Phase 1 - whisper resident: transcribe every segment of every session.
  const transcribed: TranscribedSession[] = []
  for (const session of sessions) {
    deps.onProgress?.({ phase: 'transcribing', done: transcribed.length, total: sessions.length })
    const probed = await probeTranscribeSegments(session.segments, recordingPath, deps.executor)
    const timelineSegments: TimelineSegment[] = probed.map(p => ({
      id: p.id,
      startMs: captureStartedAtMs + p.startMs,
      endMs: captureStartedAtMs + p.endMs,
      transcript: p.transcript
    }))
    // Note-first: which of THIS session's segments the user flagged (anchors in its span).
    const anchorsInSession = anchorsMs.filter(
      at => at >= session.startMs && at <= session.endMs
    )
    const flaggedSegmentIds = flagSegmentsForAnchors(
      probed.map(p => ({ id: p.id, startMs: p.startMs, endMs: p.endMs })),
      anchorsInSession
    )
    const flaggedSet = new Set(flaggedSegmentIds)
    transcribed.push({
      sessionId: session.id,
      sessionStartMs: session.startMs,
      sessionEndMs: session.endMs,
      speechMs: session.segments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0),
      transcript: probed
        .map(p => p.transcript)
        .filter((t): t is string => !!t)
        .join(' '),
      flaggedSegmentIds,
      flaggedSnippets: probed
        .filter(p => flaggedSet.has(p.id) && p.transcript)
        .map(p => p.transcript as string),
      segments: timelineSegments
    })
  }

  // Hand-off: bring the text model into residency now that whisper's work is done.
  deps.onProgress?.({ phase: 'loading-model' })
  await deps.prepareForSummaries?.()

  // Phase 2 - text LLM resident: summarise every session, prioritising flagged moments.
  const built: TimelineSession[] = []
  for (const item of transcribed) {
    deps.onProgress?.({ phase: 'summarizing', done: built.length, total: transcribed.length })
    const { summary, status } = await deps.summarize(item.transcript, item.flaggedSnippets)
    built.push({
      id: `${captureStartedAtMs}_${item.sessionId}`,
      startMs: captureStartedAtMs + item.sessionStartMs,
      endMs: captureStartedAtMs + item.sessionEndMs,
      speechMs: item.speechMs,
      summary,
      summaryStatus: status,
      flaggedSegmentIds: item.flaggedSegmentIds,
      recordingPath,
      captureStartedAtMs,
      segments: item.segments
    })
  }
  return built
}

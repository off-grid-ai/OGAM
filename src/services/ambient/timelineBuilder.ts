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
import { EMPTY_SUMMARY, type AmbientSummary } from './summaryPrompt'

// Cap for a single on-device summary generation before we give up and save transcript-only.
const SUMMARY_TIMEOUT_MS = 120_000
import type { TimelineSession, TimelineSegment, SessionRelevance } from './timelineModel'

/** Coarse progress for the UI, so a long capture is not an opaque wait. */
export type BuildProgress =
  | { phase: 'transcribing'; done: number; total: number }
  | { phase: 'diarizing'; done: number; total: number }
  | { phase: 'loading-model' }
  | { phase: 'summarizing'; done: number; total: number }

/** One conversation's speaker result: its segments labeled with who spoke, + the relevance verdict. */
export interface SpeakerAnnotation {
  segments: TimelineSegment[]
  relevance: SessionRelevance | null
}

/**
 * Build a speaker-attributed transcript from labeled segments: consecutive segments by the same speaker
 * become one "Name: …" line. This is what we feed the summary so it can attribute decisions/actions to
 * people and extract participants from real identity, not guesses. Unlabeled speech has no prefix.
 */
export function speakerAttributedTranscript(segments: TimelineSegment[]): string {
  const lines: string[] = []
  let speaker: string | null = null
  let buffer: string[] = []
  const flush = () => {
    if (buffer.length === 0) return
    lines.push((speaker ? `${speaker}: ` : '') + buffer.join(' '))
    buffer = []
  }
  for (const s of segments) {
    if (!s.transcript) continue
    const name = s.speakerName ?? null
    if (name !== speaker) {
      flush()
      speaker = name
    }
    buffer.push(s.transcript)
  }
  flush()
  return lines.join('\n')
}

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
  /**
   * Diarize + identify ONE conversation, between transcription and summary, so the summary sees
   * speaker-attributed text and we know which conversations the owner is in. Runs as its own residency
   * phase (diarizer model resident, whisper evicted, before the text model loads). Best-effort — a null
   * return or a throw just means an unlabeled transcript + no relevance verdict (today's behaviour).
   */
  annotate?: (input: {
    id: string
    recordingPath: string
    captureStartedAtMs: number
    segments: TimelineSegment[]
  }) => Promise<SpeakerAnnotation | null>
  /**
   * Residency handoff BEFORE diarization: evict the transcription model so the diarizer loads alone
   * (the phone holds one model at a time). Only called when there's diarization work to do.
   */
  prepareForDiarize?: () => Promise<void>
  /** Residency handoff AFTER diarization: free the diarizer model so the text model has room to load. */
  releaseDiarizer?: () => Promise<void>
  /**
   * The live (real-time) transcript captured during recording. Used ONLY as a safety net for the
   * whole-take fallback: when the batch re-transcription of the recording file comes back empty (the
   * file reads as blank audio on some devices though the live frame tap heard real speech), a single
   * whole-take session adopts this text instead of being saved empty. Ignored when real segments
   * transcribe normally.
   */
  fallbackTranscript?: string
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

  // Whole-take safety net: when the ONLY session came back with no transcript — the recording file read
  // as blank audio on this device even though the live frame tap heard real speech — adopt the live
  // transcript so the take is saved with its words instead of as an empty "Conversation".
  //
  // Extended beyond the empty case: the VAD segmenter can UNDER-cover a continuous take (a long read
  // with few phrase-closes), so the per-segment rebuild comes back as only a fraction of what the user
  // watched appear live. When the live transcript is substantially fuller than the rebuild, adopt it —
  // the processed transcript (and therefore the summary, to-dos and journal) must not be a few lines of
  // a take the user saw transcribed in full.
  if (transcribed.length === 1 && deps.fallbackTranscript?.trim()) {
    const live = deps.fallbackTranscript.trim()
    const rebuilt = transcribed[0].transcript.trim()
    const liveWords = live.split(/\s+/).length
    const rebuiltWords = rebuilt ? rebuilt.split(/\s+/).length : 0
    // Adopt when the rebuild is empty, or when the live transcriber captured clearly more (the rebuild
    // got under ~70% of the words). The live path re-decodes the whole stream, so it is the fuller one.
    if (!rebuilt || rebuiltWords < liveWords * 0.7) {
      transcribed[0].transcript = live
      if (transcribed[0].segments.length > 0) {
        transcribed[0].segments[0] = { ...transcribed[0].segments[0], transcript: live }
      }
    }
  }

  // Phase 1.5 - diarizer resident: who spoke when + who. Runs after whisper, before the text model, so
  // the summary gets speaker-attributed text and each conversation gets a relevance verdict. Best-effort:
  // any failure leaves that session's plain transcript + no verdict, exactly like before this existed.
  const annotations = new Map<string, SpeakerAnnotation>()
  if (deps.annotate) {
    // Evict whisper first so the diarizer loads alone — the phone holds ONE model at a time. The whole
    // speaker pass is best-effort: if the diarizer can't be made resident (its model isn't present, or
    // voice recognition is unavailable because Pro didn't load), skip it and keep every session's plain
    // transcript rather than losing the recording. A throw HERE used to abort the whole build.
    let diarizerResident = true
    try {
      await deps.prepareForDiarize?.()
    } catch (e) {
      diarizerResident = false
      console.warn('[ambient] diarizer prepare failed — skipping speaker labels', e)
    }
    if (diarizerResident) {
      for (let i = 0; i < transcribed.length; i += 1) {
        deps.onProgress?.({ phase: 'diarizing', done: i, total: transcribed.length })
        const item = transcribed[i]
        try {
          const ann = await deps.annotate({
            id: item.sessionId,
            recordingPath,
            captureStartedAtMs,
            segments: item.segments
          })
          if (ann) {
            annotations.set(item.sessionId, ann)
            item.segments = ann.segments // labeled segments carry into the built session
          }
        } catch {
          // keep the plain transcript for this session
        }
      }
      // Free the diarizer before the text model loads for summaries.
      try {
        await deps.releaseDiarizer?.()
      } catch (e) {
        console.warn('[ambient] diarizer release failed', e)
      }
    }
  }

  // Hand-off: bring the text model into residency now that whisper + the diarizer are done. Best-effort:
  // a text model that can't load (no model set, Pro didn't load, out of memory) leaves transcript-only
  // sessions instead of dropping the whole take — the conversation + its transcript are still saved.
  deps.onProgress?.({ phase: 'loading-model' })
  let summariesAvailable = true
  try {
    await deps.prepareForSummaries?.()
  } catch (e) {
    summariesAvailable = false
    console.warn('[ambient] summary model prepare failed — saving transcript-only', e)
  }

  // Phase 2 - text LLM resident: summarise every session, prioritising flagged moments. When we have
  // speaker labels, the summary is fed a "Name: …" transcript so it can attribute decisions/actions and
  // extract participants from real identity. Each summary is best-effort: a failure saves the session
  // with a transcript-derived fallback summary rather than throwing away the whole recording.
  const built: TimelineSession[] = []
  for (const item of transcribed) {
    deps.onProgress?.({ phase: 'summarizing', done: built.length, total: transcribed.length })
    const ann = annotations.get(item.sessionId)
    const transcriptForSummary = ann ? speakerAttributedTranscript(item.segments) : item.transcript
    let summary: AmbientSummary
    let status: SummarizeResult['status']
    if (summariesAvailable) {
      // Bound the on-device summary: a stuck generation must not trap the user on the Processing screen
      // forever. On timeout we fall back to the transcript-only session, same as a throw. The timer is
      // always cleared so it never leaks past a fast summary.
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const res = await Promise.race([
          deps.summarize(transcriptForSummary, item.flaggedSnippets),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('summary timed out')), SUMMARY_TIMEOUT_MS)
          })
        ])
        summary = res.summary
        status = res.status
      } catch (e) {
        console.warn('[ambient] summarize failed — saving transcript-only', e)
        summary = fallbackSummary(item.transcript)
        status = 'error'
      } finally {
        if (timer) clearTimeout(timer)
      }
    } else {
      summary = fallbackSummary(item.transcript)
      status = 'error'
    }
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
      segments: item.segments,
      relevance: ann?.relevance ?? undefined
    })
  }
  return built
}

// A minimal summary when the text model is unavailable or summarising throws: name the conversation from
// the first words and use the first sentence as the headline, so a transcript-only session still reads as
// a real conversation in the timeline instead of being dropped.
function fallbackSummary(transcript: string): AmbientSummary {
  const text = transcript.trim()
  if (!text) return { ...EMPTY_SUMMARY }
  const title = text.split(/\s+/).slice(0, 6).join(' ')
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text
  return { ...EMPTY_SUMMARY, title, headline: sentence.slice(0, 160) }
}

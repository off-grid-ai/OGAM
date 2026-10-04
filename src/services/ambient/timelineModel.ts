/**
 * The timeline's data shape and its pure grouping rule.
 *
 * A captured conversation becomes a TimelineSession: absolute wall-clock span, the structured summary,
 * and the transcribed segments underneath. Times are ABSOLUTE (epoch ms) here on purpose - segments
 * come off the recorder relative to a capture's start, but the timeline shows a day, so the conversion
 * happens once when a session is built and everything downstream reads real times.
 *
 * Pure and store-free so the "group a flat session list into days, newest first" rule is tested on its
 * own and shared by the store and any other reader.
 */

import type { AmbientSummary } from './summaryPrompt'
import type { SummaryStatus } from './summarizer'

export interface TimelineSegment {
  id: string
  startMs: number
  endMs: number
  transcript: string | null
  /** Identified speaker (voice fingerprinting). Absent = not run; null id = heard but unknown. */
  speakerId?: string | null
  speakerName?: string | null
}

/**
 * Relevance verdict for a conversation — is this one the OWNER is actually in, or overheard/ambient
 * (traffic, a TV, the baristas across the counter). Set by the relevance gate after diarization; absent
 * means "not assessed" (older records, owner not enrolled, or the gate didn't run) → treated as kept.
 */
export interface SessionRelevance {
  /** true → demoted to the Ambient bucket: kept + searchable, but out of journal/to-dos and the main Day. */
  ambient: boolean
  /** Combined relevance score in [0,1]. */
  score: number
  /** Human-readable explanation of the verdict, for a "why is this ambient?" affordance. */
  reason: string
}

export interface TimelineSession {
  id: string
  /** Absolute epoch ms. */
  startMs: number
  endMs: number
  /** Total speech captured in the session (sum of segment spans), for the "Nm speech" stat. */
  speechMs: number
  summary: AmbientSummary
  /** Why the summary is what it is - so the card can explain an empty one. */
  summaryStatus: SummaryStatus
  /** Segment ids the user flagged live (note-first anchoring). */
  flaggedSegmentIds: string[]
  /** The capture file this conversation lives in, for Replay. Absent on older records. */
  recordingPath?: string
  /** Epoch ms the capture started, so a segment's offset within the file = its time - this. */
  captureStartedAtMs?: number
  segments: TimelineSegment[]
  /** Relevance verdict (owner-in vs ambient/overheard). Absent = not assessed → treated as kept. */
  relevance?: SessionRelevance
  /**
   * The user's explicit include/exclude override for this conversation. Wins over `relevance`: a Day is
   * a projection over INCLUDED conversations, so toggling this adds/removes the conversation and — since
   * to-dos/journal/actions are derived from the included set — cascades to everything derived from it.
   * Absent = follow the relevance verdict.
   */
  userOverride?: boolean
  /** Per-conversation journal snippet — the source of truth the day's stitched narrative is built from. */
  journalSnippet?: string
}

/** A session counts as ambient only when the relevance gate said so — absent verdict = a normal one. */
export function isAmbientSession(session: TimelineSession): boolean {
  return session.relevance?.ambient === true
}

/**
 * Is this conversation part of the Day? The user's explicit override wins; otherwise it follows
 * relevance (ambient → excluded, everything else → included). This single predicate drives the whole
 * projection: the day's to-dos, journal, and actions are computed from the sessions it returns true for,
 * so include/exclude (manual or from relevance) automatically adds or removes their derived items.
 */
export function isIncludedSession(session: TimelineSession): boolean {
  if (typeof session.userOverride === 'boolean') return session.userOverride
  return !isAmbientSession(session)
}

export interface DayGroup {
  /** 'YYYY-MM-DD' in local time. */
  dayKey: string
  sessions: TimelineSession[]
  /** Sum of every session's speechMs, for the day header. */
  speechMs: number
}

/** Local-time day key for an epoch ms. Injected date parts keep it pure and testable. */
export function dayKeyOf(epochMs: number, toParts: (ms: number) => { y: number; m: number; d: number }): string {
  const { y, m, d } = toParts(epochMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${y}-${pad(m)}-${pad(d)}`
}

/**
 * Group sessions into days, newest day first and newest session first within a day. A pure reducer -
 * the store holds a flat list; the UI renders this.
 */
export function groupSessionsByDay(
  sessions: TimelineSession[],
  toParts: (ms: number) => { y: number; m: number; d: number }
): DayGroup[] {
  const byDay = new Map<string, TimelineSession[]>()
  for (const session of sessions) {
    const key = dayKeyOf(session.startMs, toParts)
    const list = byDay.get(key)
    if (list) {
      list.push(session)
    } else {
      byDay.set(key, [session])
    }
  }
  return [...byDay.entries()]
    .map(([dayKey, group]) => {
      const ordered = [...group].sort((a, b) => b.startMs - a.startMs)
      return {
        dayKey,
        sessions: ordered,
        speechMs: ordered.reduce((sum, s) => sum + s.speechMs, 0)
      }
    })
    .sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0))
}

/**
 * The distinct speakers voice-fingerprinting actually detected in a session — recognized names first,
 * then anonymous "Speaker N". Empty when diarization hasn't run (segments carry no speaker). Lets the
 * timeline show who was in each conversation, which is how you verify the feature is working.
 */
export function sessionSpeakers(session: TimelineSession): string[] {
  const known: string[] = []
  const anon: string[] = []
  const seen = new Set<string>()
  for (const seg of session.segments) {
    const name = seg.speakerName
    if (!name || seen.has(name)) continue
    seen.add(name)
    ;(name.startsWith('Speaker ') ? anon : known).push(name)
  }
  return [...known, ...anon]
}

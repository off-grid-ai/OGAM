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

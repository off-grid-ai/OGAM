/**
 * Grouping raw speech segments into conversations.
 *
 * The 24/7 recorder emits a stream of short speech segments (VAD spans). A day of those is unreadable;
 * the timeline's unit is a CONVERSATION - a run of speech with only short pauses, bounded by a long
 * silence (you stopped talking, walked away, the room went quiet). This splits the stream on that gap
 * so each timeline card is one coherent stretch, not 200 clips.
 *
 * PURE - segments in, sessions out - so the split rule is one tested answer shared by capture-time
 * grouping and any later re-grouping, not re-derived per surface. The gap threshold IS the product
 * decision (too small: one chat shatters into fragments; too large: unrelated talks merge), so it's a
 * named, tunable config rather than a magic number.
 */

import type { SpeechSegment } from './vadSegmenter'

export interface AmbientSession {
  /** Stable within a capture: the session's own span. */
  id: string
  startMs: number
  endMs: number
  segments: SpeechSegment[]
}

export interface SessionizerConfig {
  /** A silence longer than this between two segments starts a new conversation. */
  sessionGapMs: number
  /** Force a boundary once a session runs this long, so a marathon never becomes one card. */
  maxSessionMs: number
}

/** 90s of quiet ends a conversation; 30min caps a single card. Tuned for review-later, not calls. */
export const DEFAULT_SESSIONIZER_CONFIG: SessionizerConfig = {
  sessionGapMs: 90_000,
  maxSessionMs: 30 * 60_000
}

const sessionId = (first: SpeechSegment, last: SpeechSegment): string =>
  `s_${first.startMs}_${last.endMs}`

export function sessionizeSegments(
  segments: SpeechSegment[],
  config: SessionizerConfig = DEFAULT_SESSIONIZER_CONFIG
): AmbientSession[] {
  if (segments.length === 0) return []
  // Defensive: the split rule assumes chronological order; a caller's queue may not guarantee it.
  const ordered = [...segments].sort((a, b) => a.startMs - b.startMs)

  const sessions: AmbientSession[] = []
  let current: SpeechSegment[] = [ordered[0]!]

  const flush = (): void => {
    const first = current[0]!
    const last = current[current.length - 1]!
    sessions.push({
      id: sessionId(first, last),
      startMs: first.startMs,
      endMs: last.endMs,
      segments: current
    })
  }

  for (let i = 1; i < ordered.length; i += 1) {
    const segment = ordered[i]!
    const previous = current[current.length - 1]!
    const gap = segment.startMs - previous.endMs
    const sessionSpan = segment.endMs - current[0]!.startMs
    if (gap > config.sessionGapMs || sessionSpan > config.maxSessionMs) {
      flush()
      current = [segment]
    } else {
      current.push(segment)
    }
  }
  flush()
  return sessions
}

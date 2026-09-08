/**
 * How long the raw capture audio is kept.
 *
 * Replay needs the capture WAV, but a 24/7 recorder can't keep every day's audio forever. After a
 * window we delete the capture files (the transcript + summary stay - only Replay for old
 * conversations goes away). A file backs a whole capture, which may hold several conversations, so it
 * is expired only once ALL its conversations are older than the window.
 *
 * PURE: sessions + now + window in, the file paths safe to delete out.
 */

import type { TimelineSession } from './timelineModel'

export const DEFAULT_RETENTION_DAYS = 7
export const DAY_MS = 24 * 60 * 60 * 1000

/** The capture files whose every conversation is older than the window - safe to delete. */
export function expiredRecordingPaths(
  sessions: TimelineSession[],
  nowMs: number,
  windowMs: number
): string[] {
  const cutoff = nowMs - windowMs
  const newestByPath = new Map<string, number>()
  for (const s of sessions) {
    if (!s.recordingPath) continue
    newestByPath.set(s.recordingPath, Math.max(newestByPath.get(s.recordingPath) ?? 0, s.startMs))
  }
  return [...newestByPath.entries()].filter(([, newest]) => newest < cutoff).map(([path]) => path)
}

/**
 * Deletes the capture audio past the retention window. The decision (which paths) is pure
 * (expiredRecordingPaths); this does the file I/O, best-effort - a file already gone is fine.
 */

import RNFS from 'react-native-fs'
import { expiredRecordingPaths, DAY_MS } from './retentionModel'
import type { TimelineSession } from './timelineModel'

export interface RetentionDeps {
  deleteFile: (path: string) => Promise<void>
  now: () => number
}

/** Delete capture files older than `retentionDays`; returns how many were removed. */
export async function cleanupExpiredAudio(
  sessions: TimelineSession[],
  retentionDays: number,
  deps: RetentionDeps
): Promise<number> {
  const paths = expiredRecordingPaths(sessions, deps.now(), retentionDays * DAY_MS)
  let removed = 0
  for (const path of paths) {
    try {
      await deps.deleteFile(path)
      removed += 1
    } catch {
      // Already gone or unreadable - nothing to do.
    }
  }
  return removed
}

export function runAudioRetention(sessions: TimelineSession[], retentionDays: number): Promise<number> {
  return cleanupExpiredAudio(sessions, retentionDays, {
    deleteFile: path => RNFS.unlink(path),
    now: () => Date.now()
  })
}

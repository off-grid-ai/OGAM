/**
 * Retention: a capture file is expired only once every conversation in it is older than the window;
 * cleanup deletes exactly those, tolerates a missing file, and reports the count.
 */

import { expiredRecordingPaths, DAY_MS } from '../../../../src/services/ambient/retentionModel'
import { cleanupExpiredAudio, type RetentionDeps } from '../../../../src/services/ambient/retentionService'
import { EMPTY_SUMMARY } from '../../../../src/services/ambient/summaryPrompt'
import type { TimelineSession } from '../../../../src/services/ambient/timelineModel'

const NOW = 100 * DAY_MS
const session = (startDaysAgo: number, recordingPath?: string): TimelineSession => ({
  id: `${startDaysAgo}-${recordingPath}`, startMs: NOW - startDaysAgo * DAY_MS, endMs: NOW, speechMs: 1,
  summary: { ...EMPTY_SUMMARY }, summaryStatus: 'ok', flaggedSegmentIds: [], segments: [], recordingPath
})

describe('expiredRecordingPaths', () => {
  it('expires a file only when all its conversations are older than the window', () => {
    const sessions = [
      session(10, '/old.wav'), // 10 days ago
      session(9, '/old.wav'), // same file, still old
      session(2, '/recent.wav'), // 2 days ago
      session(10, '/mixed.wav'), // old...
      session(1, '/mixed.wav') // ...but has a recent conversation too
    ]
    const expired = expiredRecordingPaths(sessions, NOW, 7 * DAY_MS)
    expect(expired).toEqual(['/old.wav']) // recent + mixed are kept
  })

  it('ignores sessions with no recording path', () => {
    expect(expiredRecordingPaths([session(30)], NOW, 7 * DAY_MS)).toEqual([])
  })
})

describe('cleanupExpiredAudio', () => {
  it('deletes expired files and counts them, tolerating a missing one', async () => {
    const deleted: string[] = []
    const deps: RetentionDeps = {
      now: () => NOW,
      deleteFile: async path => {
        if (path === '/gone.wav') throw new Error('ENOENT')
        deleted.push(path)
      }
    }
    const sessions = [session(30, '/a.wav'), session(30, '/gone.wav'), session(1, '/keep.wav')]
    const removed = await cleanupExpiredAudio(sessions, 7, deps)
    expect(deleted).toEqual(['/a.wav'])
    expect(removed).toBe(1) // /gone.wav threw, /keep.wav is recent
  })
})

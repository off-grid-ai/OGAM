/**
 * Replay clip prep: the conversation's offset within the capture (its time minus the capture start) is
 * computed correctly and passed to the slicer; a session without audio refs yields no source.
 */

import {
  prepareReplayClip,
  replaySourceForSession,
  type ReplayDeps
} from '../../../../src/services/ambient/replayClip'
import { EMPTY_SUMMARY } from '../../../../src/services/ambient/summaryPrompt'
import type { TimelineSession } from '../../../../src/services/ambient/timelineModel'

const session = (over: Partial<TimelineSession> = {}): TimelineSession => ({
  id: 's', startMs: 1_005_000, endMs: 1_012_000, speechMs: 7000,
  summary: { ...EMPTY_SUMMARY }, summaryStatus: 'ok', flaggedSegmentIds: [], segments: [],
  recordingPath: '/rec.wav', captureStartedAtMs: 1_000_000, ...over
})

describe('replaySourceForSession', () => {
  it('builds a source from a session with audio refs', () => {
    expect(replaySourceForSession(session())).toEqual({
      recordingPath: '/rec.wav', startMs: 1_005_000, endMs: 1_012_000, captureStartedAtMs: 1_000_000
    })
  })
  it('returns null when the record predates audio retention', () => {
    expect(replaySourceForSession(session({ recordingPath: undefined }))).toBeNull()
    expect(replaySourceForSession(session({ captureStartedAtMs: undefined }))).toBeNull()
  })
})

describe('prepareReplayClip', () => {
  it('extracts the conversation span at the right offset and returns the clip path', async () => {
    const calls: Array<[string, number, number, string]> = []
    const deps: ReplayDeps = {
      extractSegment: async (src, start, end, out) => {
        calls.push([src, start, end, out])
        return true
      },
      outPath: key => `/clips/${key}.wav`
    }
    const out = await prepareReplayClip(replaySourceForSession(session())!, deps)
    // offset = absolute - captureStartedAt = 5000..12000 ms
    expect(calls).toEqual([['/rec.wav', 5000, 12000, '/clips/1005000-1012000.wav']])
    expect(out).toBe('/clips/1005000-1012000.wav')
  })

  it('returns null when the clip could not be carved out', async () => {
    const out = await prepareReplayClip(replaySourceForSession(session())!, {
      extractSegment: async () => false,
      outPath: () => '/clips/x.wav'
    })
    expect(out).toBeNull()
  })
})

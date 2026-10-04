import { sessionSpeakers } from '../timelineModel'
import type { TimelineSession } from '../timelineModel'

function session(segs: Array<{ speakerName?: string | null }>): TimelineSession {
  return {
    id: 's', startMs: 0, endMs: 1, speechMs: 1,
    summary: { title: '', headline: '', decisions: [], actionItems: [], people: [] } as never,
    summaryStatus: 'ok' as never, flaggedSegmentIds: [],
    segments: segs.map((x, i) => ({ id: `${i}`, startMs: i, endMs: i + 1, transcript: 'x', speakerName: x.speakerName })),
  }
}

describe('sessionSpeakers', () => {
  it('lists distinct speakers, real names before anonymous', () => {
    const s = session([
      { speakerName: 'Speaker 1' }, { speakerName: 'Sidd' }, { speakerName: 'Sidd' },
      { speakerName: 'Priya' }, { speakerName: 'Speaker 1' },
    ])
    expect(sessionSpeakers(s)).toEqual(['Sidd', 'Priya', 'Speaker 1'])
  })
  it('is empty when no speakers were detected', () => {
    expect(sessionSpeakers(session([{ speakerName: null }, {}]))).toEqual([])
  })
})

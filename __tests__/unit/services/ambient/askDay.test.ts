/**
 * Ask-your-day retrieval + prompt: the ranking finds the right conversation by keyword, ignores
 * stopwords, breaks ties toward recency, and returns nothing on no match; the prompt grounds the
 * question in only the ranked conversations and forbids invention.
 */

import {
  rankSessionsForQuery,
  buildAskMessages,
  sessionText,
  askDay,
  type AskDeps
} from '../../../../src/services/ambient/askDay'
import { EMPTY_SUMMARY } from '../../../../src/services/ambient/summaryPrompt'
import type { TimelineSession } from '../../../../src/services/ambient/timelineModel'

function session(id: string, startMs: number, over: Partial<TimelineSession['summary']>, transcript = ''): TimelineSession {
  return {
    id,
    startMs,
    endMs: startMs + 1000,
    speechMs: 1000,
    summary: { ...EMPTY_SUMMARY, ...over },
    summaryStatus: 'ok',
    flaggedSegmentIds: [],
    segments: transcript ? [{ id: `${id}-s`, startMs, endMs: startMs + 1000, transcript }] : []
  }
}

const sessions = [
  session('a', 1000, { title: 'Standup', headline: 'Agreed to ship ambient by Friday.' }, 'we ship the recorder friday'),
  session('b', 2000, { title: 'Vendor call' }, 'they will send a revised quote monday'),
  session('c', 3000, { title: 'Lunch' }, 'talked about the weather')
]

describe('rankSessionsForQuery', () => {
  it('finds the conversation matching the query terms', () => {
    const ranked = rankSessionsForQuery(sessions, 'when do we ship the recorder?', 3)
    expect(ranked[0].session.id).toBe('a')
    expect(ranked[0].score).toBeGreaterThan(0)
  })

  it('drops stopwords and short tokens so they do not dominate', () => {
    // "the", "do", "we" are stopwords/short; only "recorder"/"ship" should score.
    const ranked = rankSessionsForQuery(sessions, 'the do we', 3)
    expect(ranked).toEqual([])
  })

  it('returns nothing when no conversation matches', () => {
    expect(rankSessionsForQuery(sessions, 'quarterly taxes', 3)).toEqual([])
  })

  it('caps results at the limit', () => {
    const ranked = rankSessionsForQuery(sessions, 'ship quote weather', 2)
    expect(ranked.length).toBeLessThanOrEqual(2)
  })

  it('sessionText includes summary fields and transcripts', () => {
    const text = sessionText(sessions[1])
    expect(text).toContain('vendor call')
    expect(text).toContain('revised quote monday')
  })
})

describe('buildAskMessages', () => {
  const clockOf = (ms: number) => `T${ms}`

  it('grounds the question in the ranked conversations and forbids invention', () => {
    const ranked = rankSessionsForQuery(sessions, 'ship recorder', 3)
    const [system, user] = buildAskMessages('when do we ship?', ranked, clockOf)
    expect(system.content).toMatch(/only the conversations/i)
    expect(system.content).toMatch(/do not invent/i)
    expect(user.content).toContain('when do we ship?')
    expect(user.content).toContain('Standup')
    expect(user.content).toContain('ship the recorder friday')
  })
})

describe('askDay', () => {
  const clockOf = (ms: number) => `T${ms}`
  const ready: Pick<AskDeps, 'isReady'> = { isReady: () => true }

  it('answers from the matching conversations and returns them as sources', async () => {
    const deps: AskDeps = { ...ready, generate: async () => 'You ship it Friday.' }
    const res = await askDay('when do we ship the recorder?', sessions, deps, clockOf)
    expect(res.status).toBe('ok')
    expect(res.answer).toBe('You ship it Friday.')
    expect(res.sources.map(s => s.id)).toContain('a')
  })

  it('reports no-model when no text engine is ready, without generating', async () => {
    let called = false
    const res = await askDay('when do we ship?', sessions, { isReady: () => false, generate: async () => { called = true; return 'x' } }, clockOf)
    expect(res.status).toBe('no-model')
    expect(called).toBe(false)
  })

  it('reports no-matches when nothing in the day is relevant', async () => {
    const res = await askDay('quarterly taxes', sessions, { ...ready, generate: async () => 'x' }, clockOf)
    expect(res.status).toBe('no-matches')
  })

  it('reports empty-question for a blank query', async () => {
    const res = await askDay('   ', sessions, { ...ready, generate: async () => 'x' }, clockOf)
    expect(res.status).toBe('empty-question')
  })

  it('degrades to error when the model throws', async () => {
    const res = await askDay('ship recorder', sessions, { ...ready, generate: async () => { throw new Error('boom') } }, clockOf)
    expect(res.status).toBe('error')
  })
})

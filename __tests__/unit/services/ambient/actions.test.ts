/**
 * Day actions: format the day into the shared proactive-action context, and propose through the shared
 * prompt+parser contract. Pins the status branches (nothing to act on / no model / error / ok) and
 * that the built prompt carries the day's todos + calls.
 */

import {
  formatCallsForActions,
  formatTodosForActions
} from '../../../../src/services/ambient/actionsModel'
import { proposeDayActions, type ActionsDeps } from '../../../../src/services/ambient/actionsProposer'
import { EMPTY_SUMMARY } from '../../../../src/services/ambient/summaryPrompt'
import type { TimelineSession } from '../../../../src/services/ambient/timelineModel'
import type { DayTask } from '../../../../src/services/ambient/dayModel'

const session = (over: Partial<TimelineSession['summary']>): TimelineSession => ({
  id: 's', startMs: 0, endMs: 1, speechMs: 1,
  summary: { ...EMPTY_SUMMARY, ...over }, summaryStatus: 'ok', flaggedSegmentIds: [], segments: []
})
const task = (over: Partial<DayTask>): DayTask => ({
  id: 'a#0', text: 'Fix the build', sessionId: 'a', sessionTitle: 'Standup', sessionStartMs: 0, done: false, ...over
})

describe('formatters', () => {
  it('formats calls with people and decisions, skipping empty summaries', () => {
    const out = formatCallsForActions([
      session({ title: 'Standup', headline: 'Ship Friday.', people: ['Priya'], decisions: ['Ship Friday'] }),
      session({ title: 'Empty', headline: '' })
    ])
    expect(out).toBe('- Standup with Priya: Ship Friday. Decided: Ship Friday.')
  })
  it('formats only open todos with their source', () => {
    const out = formatTodosForActions([task({}), task({ id: 'a#1', text: 'Done one', done: true })])
    expect(out).toBe('- Fix the build (from Standup)')
  })
})

describe('proposeDayActions', () => {
  const ready: Pick<ActionsDeps, 'isReady'> = { isReady: () => true }
  const ctx = { todos: '- Fix the build (from Standup)', calls: '- Standup: Ship Friday.' }

  it('builds the prompt from the day and returns parsed proposals', async () => {
    let prompt = ''
    const deps: ActionsDeps = {
      ...ready,
      generate: async p => {
        prompt = p
        return '{"actions":[{"title":"Message Priya the build","connector":"Messages","why":"you committed"}]}'
      }
    }
    const res = await proposeDayActions(ctx, deps)
    expect(res.status).toBe('ok')
    expect(res.proposals).toHaveLength(1)
    expect(res.proposals[0].title).toBe('Message Priya the build')
    expect(prompt).toContain('Fix the build')
    expect(prompt).toContain('Ship Friday')
  })

  it('reports no-speech when there is nothing to act on, without calling the model', async () => {
    let called = false
    const res = await proposeDayActions({ todos: '  ', calls: '' }, { isReady: () => true, generate: async () => { called = true; return '[]'; } })
    expect(called).toBe(false)
    expect(res.status).toBe('no-speech')
  })

  it('reports no-model when no engine is ready', async () => {
    const res = await proposeDayActions(ctx, { isReady: () => false, generate: async () => '[]' })
    expect(res.status).toBe('no-model')
  })

  it('degrades to error when the model throws', async () => {
    const res = await proposeDayActions(ctx, { ...ready, generate: async () => { throw new Error('boom') } })
    expect(res).toEqual({ proposals: [], status: 'error' })
  })
})

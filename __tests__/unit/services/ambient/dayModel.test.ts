/**
 * Day tasks: action items across conversations become one checkable list, oldest first, each carrying
 * its source conversation, with the done-set folded in. The open count drives the header.
 */

import {
  collectDayTasks,
  openTaskCount,
  dayTaskId
} from '../../../../src/services/ambient/dayModel'
import { EMPTY_SUMMARY } from '../../../../src/services/ambient/summaryPrompt'
import type { TimelineSession } from '../../../../src/services/ambient/timelineModel'

function session(id: string, startMs: number, title: string, actionItems: string[]): TimelineSession {
  return {
    id,
    startMs,
    endMs: startMs + 1000,
    speechMs: 1000,
    summary: { ...EMPTY_SUMMARY, title, actionItems },
    summaryStatus: 'ok',
    flaggedSegmentIds: [],
    segments: []
  }
}

const sessions = [
  session('b', 2000, 'Vendor call', ['Send the revised quote']),
  session('a', 1000, 'Standup', ['Fix the build', 'Message Priya'])
]

describe('collectDayTasks', () => {
  it('flattens action items across conversations, oldest first, with provenance', () => {
    const tasks = collectDayTasks(sessions)
    expect(tasks.map(t => t.text)).toEqual(['Fix the build', 'Message Priya', 'Send the revised quote'])
    expect(tasks[0]).toMatchObject({ id: 'a#0', sessionId: 'a', sessionTitle: 'Standup', done: false })
    expect(tasks[2]).toMatchObject({ id: 'b#0', sessionTitle: 'Vendor call' })
  })

  it('marks the tasks in the done set as done', () => {
    const tasks = collectDayTasks(sessions, new Set(['a#1']))
    expect(tasks.find(t => t.id === 'a#1')?.done).toBe(true)
    expect(tasks.find(t => t.id === 'a#0')?.done).toBe(false)
  })

  it('is empty when no conversation has an action item', () => {
    expect(collectDayTasks([session('x', 1, 'Chat', [])])).toEqual([])
  })

  it('gives a stable id from the conversation + position', () => {
    expect(dayTaskId('sess', 2)).toBe('sess#2')
  })
})

describe('openTaskCount', () => {
  it('counts only the tasks still to do', () => {
    const tasks = collectDayTasks(sessions, new Set(['a#0']))
    expect(openTaskCount(tasks)).toBe(2)
  })
})

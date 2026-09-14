import {
  buildPayload,
  applyRemote,
  emptyStamps,
  stampNow,
  type AmbientStateSlice,
  type AmbientSyncStamps
} from '../ambientSyncBridge'
import type { TimelineSession } from '../timelineModel'

function session(id: string, startMs: number): TimelineSession {
  return {
    id, startMs, endMs: startMs + 1000, speechMs: 500,
    summary: { title: id, headline: '', decisions: [], actionItems: [], people: [] },
    summaryStatus: 'ok' as TimelineSession['summaryStatus'],
    flaggedSegmentIds: [], segments: []
  }
}
const emptyState = (): AmbientStateSlice => ({ sessions: [], doneTaskIds: [], journalByDay: {}, actionsByDay: {} })

describe('ambientSyncBridge', () => {
  it('build → payload includes sessions/done/journal with stamps', () => {
    const state: AmbientStateSlice = {
      sessions: [session('s1', 100)],
      doneTaskIds: ['s1#0'],
      journalByDay: { '2026-09-14': 'hi' },
      actionsByDay: {}
    }
    const stamps: AmbientSyncStamps = { ...emptyStamps(), done: { 's1#0': stampNow('A', 5) } }
    const p = buildPayload(state, stamps, 'A')
    expect(p.sessions['s1'].stamp).toEqual({ at: 100, by: 'A' }) // fallback = startMs
    expect(p.done['s1#0']).toEqual({ value: true, stamp: { at: 5, by: 'A' } })
    expect(p.journal['2026-09-14'].value).toBe('hi')
  })

  it('serializes an un-checked to-do as value:false (so the un-check propagates)', () => {
    const state = { ...emptyState(), doneTaskIds: [] as string[] }
    const stamps: AmbientSyncStamps = { ...emptyStamps(), done: { 's1#0': stampNow('A', 9) } }
    const p = buildPayload(state, stamps, 'A')
    expect(p.done['s1#0']).toEqual({ value: false, stamp: { at: 9, by: 'A' } })
  })

  it('applyRemote pulls in a session recorded on the other device', () => {
    const local = emptyState()
    const remote = buildPayload({ ...emptyState(), sessions: [session('s2', 200)] }, emptyStamps(), 'B')
    const applied = applyRemote(local, emptyStamps(), remote, 'A')
    expect(applied.state.sessions.map(s => s.id)).toEqual(['s2'])
    expect(applied.stamps.sessions['s2']).toBeDefined()
  })

  it('applyRemote lets a newer remote to-do check win, and persists the stamp', () => {
    const local: AmbientStateSlice = { ...emptyState(), doneTaskIds: [] }
    const localStamps: AmbientSyncStamps = { ...emptyStamps(), done: { 't#0': stampNow('A', 1) } }
    const remote = buildPayload({ ...emptyState(), doneTaskIds: ['t#0'] }, { ...emptyStamps(), done: { 't#0': stampNow('B', 10) } }, 'B')
    const applied = applyRemote(local, localStamps, remote, 'A')
    expect(applied.state.doneTaskIds).toEqual(['t#0'])
    expect(applied.stamps.done['t#0']).toEqual({ at: 10, by: 'B' })
  })

  it('applyRemote keeps the local edit when it is newer', () => {
    const local: AmbientStateSlice = { ...emptyState(), journalByDay: { d: 'local-new' } }
    const localStamps: AmbientSyncStamps = { ...emptyStamps(), journal: { d: stampNow('A', 20) } }
    const remote = buildPayload({ ...emptyState(), journalByDay: { d: 'remote-old' } }, { ...emptyStamps(), journal: { d: stampNow('B', 3) } }, 'B')
    const applied = applyRemote(local, localStamps, remote, 'A')
    expect(applied.state.journalByDay.d).toBe('local-new')
  })

  it('round-trips: applying our own payload back is a no-op', () => {
    const state: AmbientStateSlice = {
      sessions: [session('s1', 100)], doneTaskIds: ['s1#0'],
      journalByDay: { d: 'j' }, actionsByDay: {}
    }
    const stamps: AmbientSyncStamps = {
      sessions: { s1: stampNow('A', 100) }, done: { 's1#0': stampNow('A', 5) },
      journal: { d: stampNow('A', 6) }, actions: {}
    }
    const p = buildPayload(state, stamps, 'A')
    const applied = applyRemote(state, stamps, p, 'A')
    expect(applied.state.doneTaskIds).toEqual(['s1#0'])
    expect(applied.state.journalByDay.d).toBe('j')
    expect(applied.state.sessions.map(s => s.id)).toEqual(['s1'])
  })
})

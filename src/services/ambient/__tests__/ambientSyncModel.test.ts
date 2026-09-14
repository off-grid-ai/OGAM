import {
  mergeAmbient,
  projectAmbient,
  isNewer,
  emptyAmbientPayload,
  type AmbientSyncPayload
} from '../ambientSyncModel'
import type { TimelineSession } from '../timelineModel'

function session(id: string, startMs: number): TimelineSession {
  return {
    id,
    startMs,
    endMs: startMs + 1000,
    transcript: 't',
    summary: { title: id, headline: '', actionItems: [] } as TimelineSession['summary'],
    summaryStatus: 'ok' as TimelineSession['summaryStatus'],
    segments: []
  }
}

const stamp = (at: number, by = 'A') => ({ at, by })

describe('ambientSyncModel', () => {
  it('isNewer breaks ties on device id', () => {
    expect(isNewer(stamp(2), stamp(1))).toBe(true)
    expect(isNewer(stamp(1), stamp(2))).toBe(false)
    expect(isNewer(stamp(1, 'B'), stamp(1, 'A'))).toBe(true)
    expect(isNewer(stamp(1, 'A'), stamp(1, 'B'))).toBe(false)
  })

  it('unions sessions from both devices', () => {
    const a: AmbientSyncPayload = { ...emptyAmbientPayload(), sessions: { s1: { value: session('s1', 100), stamp: stamp(1) } } }
    const b: AmbientSyncPayload = { ...emptyAmbientPayload(), sessions: { s2: { value: session('s2', 200), stamp: stamp(1, 'B') } } }
    const merged = mergeAmbient(a, b)
    expect(Object.keys(merged.sessions).sort()).toEqual(['s1', 's2'])
  })

  it('propagates a to-do checked on the other device (newer wins)', () => {
    const phone: AmbientSyncPayload = { ...emptyAmbientPayload(), done: { 's1#0': { value: false, stamp: stamp(1, 'A') } } }
    const desktop: AmbientSyncPayload = { ...emptyAmbientPayload(), done: { 's1#0': { value: true, stamp: stamp(5, 'B') } } }
    const merged = mergeAmbient(phone, desktop)
    expect(projectAmbient(merged).doneTaskIds).toEqual(['s1#0'])
  })

  it('ignores a stale un-check from the other device', () => {
    const phone: AmbientSyncPayload = { ...emptyAmbientPayload(), done: { 's1#0': { value: true, stamp: stamp(5, 'A') } } }
    const desktop: AmbientSyncPayload = { ...emptyAmbientPayload(), done: { 's1#0': { value: false, stamp: stamp(2, 'B') } } }
    expect(projectAmbient(mergeAmbient(phone, desktop)).doneTaskIds).toEqual(['s1#0'])
  })

  it('last-writer-wins on the journal per day', () => {
    const a: AmbientSyncPayload = { ...emptyAmbientPayload(), journal: { '2026-09-14': { value: 'old', stamp: stamp(1) } } }
    const b: AmbientSyncPayload = { ...emptyAmbientPayload(), journal: { '2026-09-14': { value: 'new', stamp: stamp(9, 'B') } } }
    expect(projectAmbient(mergeAmbient(a, b)).journalByDay['2026-09-14']).toBe('new')
  })

  it('is commutative and idempotent (converges regardless of order)', () => {
    const a: AmbientSyncPayload = { ...emptyAmbientPayload(), journal: { d: { value: 'A', stamp: stamp(3, 'A') } } }
    const b: AmbientSyncPayload = { ...emptyAmbientPayload(), journal: { d: { value: 'B', stamp: stamp(3, 'B') } } }
    const ab = mergeAmbient(a, b)
    const ba = mergeAmbient(b, a)
    expect(ab).toEqual(ba)
    expect(mergeAmbient(ab, ab)).toEqual(ab)
  })

  it('projects newest session first', () => {
    const p: AmbientSyncPayload = {
      ...emptyAmbientPayload(),
      sessions: {
        s1: { value: session('s1', 100), stamp: stamp(1) },
        s2: { value: session('s2', 300), stamp: stamp(1) },
        s3: { value: session('s3', 200), stamp: stamp(1) }
      }
    }
    expect(projectAmbient(p).sessions.map(s => s.id)).toEqual(['s2', 's3', 's1'])
  })
})

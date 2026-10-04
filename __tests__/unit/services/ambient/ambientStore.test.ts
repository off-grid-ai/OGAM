/**
 * The in-memory segment store, and — more importantly — the store driven through the REAL transcription
 * runner with a fake executor. That second half is the seam guard: it proves a captured segment flows
 * add -> pending -> transcribe -> saveTranscript and leaves the store's snapshot agreeing with itself,
 * without mocking any of our own logic. Swap in a persistent store behind the same interface and this
 * test still describes the contract.
 */

import { InMemoryAmbientStore, segmentId } from '../../../../src/services/ambient/ambientStore'
import { runTranscriptionPass } from '../../../../src/services/ambient/transcriptionRunner'
import type { DeviceConditions } from '../../../../src/services/ambient/sttScheduler'
import type { SttExecutor } from '../../../../src/services/ambient/sttExecutor'

const HEALTHY: DeviceConditions = { batteryLevel: 0.9, charging: true, macReachable: false }
const echo = (text: string): SttExecutor => ({ transcribe: async () => ({ text }) })

describe('InMemoryAmbientStore', () => {
  it('derives a stable span id and de-duplicates a re-added segment', () => {
    const store = new InMemoryAmbientStore()
    const seg = { startMs: 1000, endMs: 2000 }
    expect(segmentId(seg)).toBe('1000-2000')
    const first = store.add(seg, '/rec.wav')
    const second = store.add(seg, '/rec.wav')
    expect(second).toBe(first)
    expect(store.snapshot()).toHaveLength(1)
  })

  it('lists only untranscribed segments as pending, oldest first', async () => {
    const store = new InMemoryAmbientStore()
    store.add({ startMs: 3000, endMs: 3500 }, '/rec.wav')
    store.add({ startMs: 1000, endMs: 1500 }, '/rec.wav')
    await store.saveTranscript('1000-1500', 'done')
    const pending = await store.pending()
    expect(pending.map(p => p.id)).toEqual(['3000-3500'])
    // snapshot stays oldest-first regardless of insertion order
    expect(store.snapshot().map(r => r.id)).toEqual(['1000-1500', '3000-3500'])
  })

  it('flows a captured segment through the real runner and persists its transcript', async () => {
    const store = new InMemoryAmbientStore()
    store.add({ startMs: 0, endMs: 900 }, '/rec.wav')
    store.add({ startMs: 1600, endMs: 2100 }, '/rec.wav')

    const summary = await runTranscriptionPass({
      store,
      device: async () => HEALTHY,
      executors: () => ({ phone: echo('hello world') })
    })

    expect(summary).toEqual({ transcribed: 2, failed: 0, deferred: false })
    expect(store.snapshot().map(r => r.transcript)).toEqual(['hello world', 'hello world'])
    expect(await store.pending()).toHaveLength(0) // nothing left to do
  })

  it('bumps attempts (not transcript) when the runner reports a failure', async () => {
    const store = new InMemoryAmbientStore()
    store.add({ startMs: 0, endMs: 900 }, '/rec.wav')
    const summary = await runTranscriptionPass({
      store,
      device: async () => HEALTHY,
      executors: () => ({
        phone: { transcribe: async () => { throw new Error('whisper OOM') } }
      })
    })
    expect(summary.failed).toBe(1)
    const record = store.snapshot()[0]
    expect(record.attempts).toBe(1)
    expect(record.transcript).toBeNull()
    expect(await store.pending()).toHaveLength(1) // still pending for a later pass
  })
})

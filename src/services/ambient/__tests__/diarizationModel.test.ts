import { nameClusters, assignSpeakersToSegments } from '../diarizationModel'
import { createProfile } from '../speakerModel'
import type { DiarizedTurn } from '../speakerDiarizer'

const sidd = createProfile('u1', 'Sidd', 'ecapa-tdnn-512', [[1, 0, 0]])
const priya = createProfile('u2', 'Priya', 'ecapa-tdnn-512', [[0, 1, 0]])

describe('nameClusters', () => {
  it('names a recognized cluster and leaves strangers as stable "Speaker N"', () => {
    const turns: DiarizedTurn[] = [
      { startMs: 0, endMs: 1000, cluster: 'spk0', embedding: [0.98, 0.05, 0] }, // Sidd
      { startMs: 1000, endMs: 2000, cluster: 'spk1', embedding: [0, 0, 1] }, // stranger
      { startMs: 2000, endMs: 3000, cluster: 'spk1', embedding: [0, 0.02, 0.98] },
    ]
    const names = nameClusters(turns, [sidd, priya])
    expect(names.spk0).toEqual({ speakerId: 'u1', speakerName: 'Sidd', known: true })
    expect(names.spk1.known).toBe(false)
    expect(names.spk1.speakerName).toBe('Speaker 1')
    expect(names.spk1.speakerId).toBe('cluster:spk1')
  })

  it('numbers multiple unknown clusters in first-seen order', () => {
    const turns: DiarizedTurn[] = [
      { startMs: 0, endMs: 500, cluster: 'a', embedding: [0, 0, 1] },
      { startMs: 500, endMs: 1000, cluster: 'b', embedding: [0, 0.05, 1] },
    ]
    const names = nameClusters(turns, [sidd, priya])
    expect(names.a.speakerName).toBe('Speaker 1')
    expect(names.b.speakerName).toBe('Speaker 2')
  })

  it('averages a cluster’s turns before matching', () => {
    const turns: DiarizedTurn[] = [
      { startMs: 0, endMs: 1000, cluster: 'spk0', embedding: [1, 0, 0] },
      { startMs: 1000, endMs: 2000, cluster: 'spk0', embedding: [0.9, 0.1, 0] },
    ]
    const names = nameClusters(turns, [sidd, priya])
    expect(names.spk0.speakerName).toBe('Sidd')
  })

  it('a person names at most one cluster — the other becomes a Speaker N, not a duplicate', () => {
    // Both clusters look like Sidd; spk0 is the stronger match. Only spk0 should be "Sidd".
    const turns: DiarizedTurn[] = [
      { startMs: 0, endMs: 1000, cluster: 'spk0', embedding: [1, 0, 0] },
      { startMs: 1000, endMs: 2000, cluster: 'spk1', embedding: [0.8, 0.2, 0] },
    ]
    const names = nameClusters(turns, [sidd, priya], 0.5)
    expect(names.spk0.speakerName).toBe('Sidd')
    expect(names.spk1.known).toBe(false)
    expect(names.spk1.speakerName).toBe('Speaker 1')
  })
})

describe('assignSpeakersToSegments', () => {
  const turns: DiarizedTurn[] = [
    { startMs: 0, endMs: 1000, cluster: 'spk0' },
    { startMs: 1000, endMs: 3000, cluster: 'spk1' },
  ]
  const names = {
    spk0: { speakerId: 'u1', speakerName: 'Sidd', known: true },
    spk1: { speakerId: 'cluster:spk1', speakerName: 'Speaker 1', known: false },
  }

  it('labels each segment by the cluster it overlaps most', () => {
    const segs = [
      { id: 's1', startMs: 0, endMs: 900 }, // fully in spk0
      { id: 's2', startMs: 1200, endMs: 2800 }, // in spk1
    ]
    const out = assignSpeakersToSegments(segs, turns, names)
    expect(out.find(o => o.segmentId === 's1')?.speakerName).toBe('Sidd')
    expect(out.find(o => o.segmentId === 's2')?.speakerName).toBe('Speaker 1')
  })

  it('picks the dominant speaker when a segment straddles a boundary', () => {
    const segs = [{ id: 's1', startMs: 800, endMs: 1600 }] // 200ms spk0, 600ms spk1 → spk1
    const out = assignSpeakersToSegments(segs, turns, names)
    expect(out[0].speakerName).toBe('Speaker 1')
  })

  it('labels a segment that overlaps nothing as null (unknown)', () => {
    const segs = [{ id: 's1', startMs: 5000, endMs: 6000 }]
    const out = assignSpeakersToSegments(segs, turns, names)
    expect(out[0]).toEqual({ segmentId: 's1', speakerId: null, speakerName: null })
  })

  // Regression: timeline segments are stamped ABSOLUTE (captureStartedAtMs + offset) while a diarizer
  // runs on the 0-based recording and returns recording-relative turns. If the caller forgets to align
  // the two time bases, overlap is always zero and even a perfect voiceprint match reads "Unknown".
  it('needs turns aligned to the segments’ absolute time base to overlap at all', () => {
    const captureStartedAtMs = 1_759_000_000_000
    const absSegs = [{ id: 's1', startMs: captureStartedAtMs + 200, endMs: captureStartedAtMs + 900 }]

    // Unaligned recording-relative turns (the bug): no overlap → null.
    const bug = assignSpeakersToSegments(absSegs, turns, names)
    expect(bug[0]).toEqual({ segmentId: 's1', speakerId: null, speakerName: null })

    // Aligned (turn.startMs + captureStartedAtMs): the named cluster lands on the segment.
    const shifted = turns.map(t => ({ ...t, startMs: t.startMs + captureStartedAtMs, endMs: t.endMs + captureStartedAtMs }))
    const fixed = assignSpeakersToSegments(absSegs, shifted, names)
    expect(fixed[0].speakerName).toBe('Sidd')
  })
})

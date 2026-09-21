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
      { startMs: 500, endMs: 1000, cluster: 'b', embedding: [0.5, 0.5, 0.5] },
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
})

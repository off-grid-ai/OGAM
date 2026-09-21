import { identifySpeaker, identifySegments } from '../speakerIdentify'
import { createProfile } from '../speakerModel'

const sidd = createProfile('u1', 'Sidd', 'ecapa-tdnn-512', [[1, 0, 0]])
const priya = createProfile('u2', 'Priya', 'ecapa-tdnn-512', [[0, 1, 0]])

describe('identifySpeaker', () => {
  it('matches a known speaker confidently', async () => {
    const m = await identifySpeaker('a.wav', {
      embed: async () => [0.98, 0.05, 0],
      profiles: [sidd, priya],
    })
    expect(m.speakerId).toBe('u1')
    expect(m.name).toBe('Sidd')
    expect(m.confident).toBe(true)
  })

  it('returns unknown for an unfamiliar voice', async () => {
    const m = await identifySpeaker('a.wav', { embed: async () => [0, 0, 1], profiles: [sidd, priya] })
    expect(m.speakerId).toBeNull()
    expect(m.confident).toBe(false)
  })

  it('returns unknown (never throws) when embedding fails', async () => {
    const m = await identifySpeaker('a.wav', {
      embed: async () => { throw new Error('no model') },
      profiles: [sidd],
    })
    expect(m.speakerId).toBeNull()
  })

  it('returns unknown when there are no enrolled profiles', async () => {
    const m = await identifySpeaker('a.wav', { embed: async () => [1, 0, 0], profiles: [] })
    expect(m.speakerId).toBeNull()
  })
})

describe('identifySegments', () => {
  it('labels each segment with its match', async () => {
    const byPath: Record<string, number[]> = { 'a.wav': [1, 0, 0], 'b.wav': [0, 1, 0] }
    const res = await identifySegments(
      [{ id: 's1', slicePath: 'a.wav' }, { id: 's2', slicePath: 'b.wav' }],
      { embed: async p => byPath[p], profiles: [sidd, priya] },
    )
    expect(res.find(r => r.segmentId === 's1')?.match.name).toBe('Sidd')
    expect(res.find(r => r.segmentId === 's2')?.match.name).toBe('Priya')
  })
})

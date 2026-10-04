import { annotateSessions } from '../speakerAnnotation'
import { createProfile } from '../speakerModel'

const sidd = createProfile('u1', 'Sidd', 'ecapa-tdnn-512', [[1, 0, 0]])
const priya = createProfile('u2', 'Priya', 'ecapa-tdnn-512', [[0, 1, 0]])

function session() {
  return {
    id: 'sess1',
    recordingPath: '/rec.wav',
    segments: [
      { id: 's1', startMs: 0, endMs: 1000, transcript: 'hi' },
      { id: 's2', startMs: 1000, endMs: 2000, transcript: 'there' },
      { id: 's3', startMs: 2000, endMs: 3000, transcript: null }, // no transcript → skipped
    ],
  }
}

describe('annotateSessions', () => {
  it('labels each transcribed segment with its matched speaker', async () => {
    const labels: Record<string, string | null> = {}
    const vecs: Record<string, number[]> = { s1: [1, 0, 0], s2: [0, 1, 0] }
    const n = await annotateSessions([session()], {
      slice: async (_r, start) => `slice-${start}.wav`,
      embed: async path => (path.includes('0.wav') && !path.includes('1000') ? vecs.s1 : vecs.s2),
      profiles: [sidd, priya],
      setSpeaker: (_sid, segId, _spId, name) => { labels[segId] = name },
    })
    expect(labels.s1).toBe('Sidd')
    expect(labels.s2).toBe('Priya')
    expect(labels.s3).toBeUndefined() // untranscribed never touched
    expect(n).toBe(2)
  })

  it('does nothing when no profiles are enrolled', async () => {
    let calls = 0
    const n = await annotateSessions([session()], {
      slice: async () => { calls += 1; return 'x.wav' },
      embed: async () => [1, 0, 0],
      profiles: [],
      setSpeaker: () => { calls += 1 },
    })
    expect(n).toBe(0)
    expect(calls).toBe(0)
  })

  it('is best-effort: a failed slice/embed skips that segment, never throws', async () => {
    const labels: Record<string, string | null> = {}
    const n = await annotateSessions([session()], {
      slice: async (_r, start) => (start === 0 ? null : `slice-${start}.wav`), // s1 slice fails
      embed: async () => { throw new Error('no model') }, // s2 embed fails
      profiles: [sidd, priya],
      setSpeaker: (_sid, segId, _spId, name) => { labels[segId] = name },
    })
    expect(labels).toEqual({})
    expect(n).toBe(0)
  })
})

import {
  normalize,
  cosineSimilarity,
  averageEmbeddings,
  createProfile,
  addSampleToProfile,
  matchSpeaker,
  DEFAULT_MATCH_THRESHOLD,
  type SpeakerProfile
} from '../speakerModel'

describe('speakerModel', () => {
  describe('normalize', () => {
    it('produces a unit vector', () => {
      const n = normalize([3, 4])
      expect(n[0]).toBeCloseTo(0.6)
      expect(n[1]).toBeCloseTo(0.8)
      expect(Math.hypot(...n)).toBeCloseTo(1)
    })
    it('leaves a zero vector as zeros (no NaN)', () => {
      expect(normalize([0, 0, 0])).toEqual([0, 0, 0])
    })
  })

  describe('cosineSimilarity', () => {
    it('is 1 for identical direction, -1 for opposite, 0 for orthogonal', () => {
      expect(cosineSimilarity([1, 0], [2, 0])).toBeCloseTo(1)
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1)
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
    })
    it('guards mismatched lengths and zero vectors', () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0)
      expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
    })
  })

  describe('averageEmbeddings', () => {
    it('averages then normalizes', () => {
      const avg = averageEmbeddings([[1, 0], [0, 1]])
      expect(avg[0]).toBeCloseTo(Math.SQRT1_2)
      expect(avg[1]).toBeCloseTo(Math.SQRT1_2)
    })
    it('returns [] for no samples', () => {
      expect(averageEmbeddings([])).toEqual([])
    })
  })

  describe('createProfile', () => {
    it('captures name, centroid and sample count', () => {
      const p = createProfile('u1', 'Sidd', 'ecapa-tdnn-512', [[1, 0], [1, 0]])
      expect(p.id).toBe('u1')
      expect(p.name).toBe('Sidd')
      expect(p.sampleCount).toBe(2)
      expect(cosineSimilarity(p.centroid, [1, 0])).toBeCloseTo(1)
    })
  })

  describe('matchSpeaker', () => {
    const sidd = createProfile('u1', 'Sidd', 'ecapa-tdnn-512', [[1, 0, 0]])
    const priya = createProfile('u2', 'Priya', 'ecapa-tdnn-512', [[0, 1, 0]])
    const profiles = [sidd, priya]

    it('identifies the closest confident speaker', () => {
      const m = matchSpeaker([0.98, 0.05, 0], profiles)
      expect(m.speakerId).toBe('u1')
      expect(m.name).toBe('Sidd')
      expect(m.confident).toBe(true)
      expect(m.score).toBeGreaterThanOrEqual(DEFAULT_MATCH_THRESHOLD)
    })

    it('returns unknown when nothing clears the threshold', () => {
      const m = matchSpeaker([0, 0, 1], profiles)
      expect(m.speakerId).toBeNull()
      expect(m.name).toBeNull()
      expect(m.confident).toBe(false)
    })

    it('returns unknown when there are no profiles', () => {
      const m = matchSpeaker([1, 0, 0], [])
      expect(m.speakerId).toBeNull()
      expect(m.score).toBe(0)
    })

    it('honours a custom threshold', () => {
      // A moderate 0.8-ish match: confident at a low bar, unknown at a strict one.
      const emb = [0.85, 0.5, 0]
      expect(matchSpeaker(emb, profiles, 0.5).confident).toBe(true)
      expect(matchSpeaker(emb, profiles, 0.95).confident).toBe(false)
    })
  })

  describe('addSampleToProfile (active learning)', () => {
    it('increments the sample count and stays normalized', () => {
      const p0 = createProfile('u1', 'Sidd', 'ecapa-tdnn-512', [[1, 0]])
      const p1 = addSampleToProfile(p0, [0, 1])
      expect(p1.sampleCount).toBe(2)
      expect(Math.hypot(...p1.centroid)).toBeCloseTo(1)
    })

    it('a correction pulls the centroid toward the new sample', () => {
      const p0 = createProfile('u1', 'Sidd', 'ecapa-tdnn-512', [[1, 0]])
      const before = cosineSimilarity(p0.centroid, [0, 1])
      const p1 = addSampleToProfile(p0, [0, 1])
      const after = cosineSimilarity(p1.centroid, [0, 1])
      expect(after).toBeGreaterThan(before)
    })

    it('weights an established profile so one sample cannot dominate', () => {
      let p: SpeakerProfile = createProfile('u1', 'Sidd', 'ecapa-tdnn-512', [[1, 0], [1, 0], [1, 0], [1, 0]])
      p = addSampleToProfile(p, [0, 1])
      // Still much closer to the original direction than the lone new sample.
      expect(cosineSimilarity(p.centroid, [1, 0])).toBeGreaterThan(cosineSimilarity(p.centroid, [0, 1]))
    })
  })
})

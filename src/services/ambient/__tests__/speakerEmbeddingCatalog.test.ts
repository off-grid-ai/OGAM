import {
  SPEAKER_EMBEDDING_MODELS,
  DEFAULT_SPEAKER_EMBEDDING_MODEL_ID,
  speakerEmbeddingModelById,
  resolveSpeakerEmbeddingModel,
} from '@offgrid/models'

describe('speaker-embedding catalog', () => {
  it('exposes multiple swappable models with a valid default', () => {
    expect(SPEAKER_EMBEDDING_MODELS.length).toBeGreaterThan(1)
    expect(speakerEmbeddingModelById(DEFAULT_SPEAKER_EMBEDDING_MODEL_ID)).toBeDefined()
  })

  it('every entry has an id, positive dim, url and format', () => {
    for (const m of SPEAKER_EMBEDDING_MODELS) {
      expect(m.id).toBeTruthy()
      expect(m.dim).toBeGreaterThan(0)
      expect(m.url).toMatch(/^https?:\/\//)
      expect(m.format).toBe('executorch')
    }
  })

  it('resolve falls back to the recommended default for unknown/empty ids', () => {
    expect(resolveSpeakerEmbeddingModel(null).id).toBe(DEFAULT_SPEAKER_EMBEDDING_MODEL_ID)
    expect(resolveSpeakerEmbeddingModel('does-not-exist').id).toBe(DEFAULT_SPEAKER_EMBEDDING_MODEL_ID)
  })

  it('has exactly one recommended default', () => {
    expect(SPEAKER_EMBEDDING_MODELS.filter(m => m.recommended)).toHaveLength(1)
  })
})

import { enrollSpeaker } from '../speakerEnrollment'
import type { SpeakerEmbedding } from '../speakerModel'

function deps(overrides: Partial<Parameters<typeof enrollSpeaker>[2]> = {}) {
  const enrolled: {
    name: string
    modelId: string
    embeddings: SpeakerEmbedding[]
    opts?: { personId?: string; enrollmentClips?: string[] }
  }[] = []
  const base = {
    embed: async (_p: string) => [1, 0],
    enroll: (
      name: string,
      modelId: string,
      embeddings: SpeakerEmbedding[],
      opts?: { personId?: string; enrollmentClips?: string[] },
    ) => {
      enrolled.push({ name, modelId, embeddings, opts })
      return `spk_${enrolled.length}`
    },
    modelId: 'ecapa-tdnn-512',
  }
  return { deps: { ...base, ...overrides }, enrolled }
}

describe('enrollSpeaker', () => {
  it('embeds every read and saves one averaged profile tagged with the model', async () => {
    const { deps: d, enrolled } = deps()
    const r = await enrollSpeaker('Priya', ['a.wav', 'b.wav', 'c.wav'], d)
    expect(r.usableSamples).toBe(3)
    expect(r.profileId).toBe('spk_1')
    expect(enrolled[0].name).toBe('Priya')
    expect(enrolled[0].modelId).toBe('ecapa-tdnn-512')
    expect(enrolled[0].embeddings).toHaveLength(3)
  })

  it('keeps the enrollment clips on the profile so the voice can be re-embedded into another engine', async () => {
    const { deps: d, enrolled } = deps()
    await enrollSpeaker('Priya', ['a.wav', 'b.wav'], d)
    expect(enrolled[0].opts?.enrollmentClips).toEqual(['a.wav', 'b.wav'])
  })

  it('skips failed reads but still enrolls from the usable ones', async () => {
    let n = 0
    const { deps: d } = deps({
      embed: async () => {
        n += 1
        if (n === 2) throw new Error('mic glitch')
        return [1, 0]
      },
    })
    const r = await enrollSpeaker('Sidd', ['a.wav', 'b.wav', 'c.wav'], d)
    expect(r.usableSamples).toBe(2)
  })

  it('rejects a blank name', async () => {
    const { deps: d } = deps()
    await expect(enrollSpeaker('   ', ['a.wav'], d)).rejects.toThrow(/name is required/)
  })

  it('errors when nothing embeds', async () => {
    const { deps: d } = deps({ embed: async () => { throw new Error('down') } })
    await expect(enrollSpeaker('Priya', ['a.wav'], d)).rejects.toThrow(/clear voice sample/)
  })
})

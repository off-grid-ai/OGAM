import {
  dispatchSpeakerEmbed,
  type SpeakerEmbedder
} from '../speakerEmbedder'

const fake = (vec: number[], opts: { fail?: boolean } = {}): SpeakerEmbedder => ({
  dim: vec.length,
  embed: async () => {
    if (opts.fail) throw new Error('backend down')
    return vec
  }
})

const input = { slicePath: '/tmp/seg.wav' }

describe('dispatchSpeakerEmbed', () => {
  it('uses the phone by default', async () => {
    const r = await dispatchSpeakerEmbed(input, { phone: fake([1, 0]) })
    expect(r.ok && r.embedder).toBe('phone')
    expect(r.ok && r.embedding).toEqual([1, 0])
  })

  it('prefers the Mac when asked and it is present', async () => {
    const r = await dispatchSpeakerEmbed(input, { phone: fake([1, 0]), mac: fake([0, 1]) }, 'mac')
    expect(r.ok && r.embedder).toBe('mac')
    expect(r.ok && r.embedding).toEqual([0, 1])
  })

  it('falls back to the phone when the Mac fails', async () => {
    const r = await dispatchSpeakerEmbed(input, { phone: fake([1, 0]), mac: fake([0, 1], { fail: true }) }, 'mac')
    expect(r.ok && r.embedder).toBe('phone')
  })

  it('falls back to the phone when the Mac is absent', async () => {
    const r = await dispatchSpeakerEmbed(input, { phone: fake([1, 0]) }, 'mac')
    expect(r.ok && r.embedder).toBe('phone')
  })

  it('reports an error when every backend fails', async () => {
    const r = await dispatchSpeakerEmbed(input, { phone: fake([1, 0], { fail: true }) })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toBe('backend down')
  })
})

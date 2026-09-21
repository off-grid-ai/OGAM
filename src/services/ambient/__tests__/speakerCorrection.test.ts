import { applySpeakerCorrection } from '../speakerCorrection'

function deps(embedding: number[] | null = [1, 0]) {
  const calls: { added: [string, number[]][]; enrolled: [string, string, number[][]][] } = {
    added: [], enrolled: [],
  }
  return {
    calls,
    deps: {
      embedding,
      modelId: 'ecapa-tdnn-512',
      addSample: (id: string, e: number[]) => calls.added.push([id, e]),
      enroll: (name: string, modelId: string, es: number[][]) => {
        calls.enrolled.push([name, modelId, es])
        return 'spk_new'
      },
    },
  }
}

describe('applySpeakerCorrection', () => {
  it('existing speaker + embedding → sharpens that profile', () => {
    const { deps: d, calls } = deps()
    const r = applySpeakerCorrection({ kind: 'existing', profileId: 'u1' }, d)
    expect(r).toEqual({ profileId: 'u1', learned: true })
    expect(calls.added).toEqual([['u1', [1, 0]]])
  })

  it('existing speaker without embedding → labels only, learned=false', () => {
    const { deps: d, calls } = deps(null)
    const r = applySpeakerCorrection({ kind: 'existing', profileId: 'u1' }, d)
    expect(r).toEqual({ profileId: 'u1', learned: false })
    expect(calls.added).toHaveLength(0)
  })

  it('new speaker + embedding → enrolls a new profile', () => {
    const { deps: d, calls } = deps()
    const r = applySpeakerCorrection({ kind: 'new', name: 'Priya' }, d)
    expect(r).toEqual({ profileId: 'spk_new', learned: true })
    expect(calls.enrolled).toEqual([['Priya', 'ecapa-tdnn-512', [[1, 0]]]])
  })

  it('new speaker without embedding → throws', () => {
    const { deps: d } = deps(null)
    expect(() => applySpeakerCorrection({ kind: 'new', name: 'Priya' }, d)).toThrow(/no voice sample/)
  })

  it('new speaker with blank name → throws', () => {
    const { deps: d } = deps()
    expect(() => applySpeakerCorrection({ kind: 'new', name: '  ' }, d)).toThrow(/name is required/)
  })
})

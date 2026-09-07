/**
 * On-device whisper executor — the compose logic (slice -> transcribe -> always clean up) proven with
 * fakes for its injected collaborators. The point is the contract: it slices the right span, feeds the
 * slice to whisper with the configured language, and deletes the throwaway slice on EVERY path,
 * including when transcription throws (a 24/7 recorder must not leak a WAV per segment).
 */

import { createPhoneSttExecutor, type PhoneSttDeps } from '../../../../src/services/ambient/phoneSttExecutor'
import type { SttInput } from '../../../../src/services/ambient/sttExecutor'

const INPUT: SttInput = { segmentId: 'seg1', recordingPath: '/rec.wav', startMs: 1000, endMs: 2500 }

function harness(overrides: Partial<PhoneSttDeps> = {}) {
  const calls = {
    extract: [] as Array<[string, number, number, string]>,
    transcribe: [] as Array<[string, { language?: string } | undefined]>,
    cleanup: [] as string[]
  }
  const deps: PhoneSttDeps = {
    extractSegment: async (source, startMs, endMs, out) => {
      calls.extract.push([source, startMs, endMs, out])
      return true
    },
    transcribe: async (path, options) => {
      calls.transcribe.push([path, options])
      return 'transcribed text'
    },
    tempPath: id => `/cache/${id}.wav`,
    cleanup: async path => {
      calls.cleanup.push(path)
    },
    language: 'en',
    ...overrides
  }
  return { executor: createPhoneSttExecutor(deps), calls }
}

describe('createPhoneSttExecutor', () => {
  it('slices the exact span, transcribes with the language, and returns the text', async () => {
    const { executor, calls } = harness()
    const result = await executor.transcribe(INPUT)
    expect(result).toEqual({ text: 'transcribed text' })
    expect(calls.extract).toEqual([['/rec.wav', 1000, 2500, '/cache/seg1.wav']])
    expect(calls.transcribe).toEqual([['/cache/seg1.wav', { language: 'en' }]])
  })

  it('deletes the throwaway slice after a successful transcription', async () => {
    const { executor, calls } = harness()
    await executor.transcribe(INPUT)
    expect(calls.cleanup).toEqual(['/cache/seg1.wav'])
  })

  it('cleans up the slice even when transcription throws, and rethrows', async () => {
    const { executor, calls } = harness({
      transcribe: async () => {
        throw new Error('whisper OOM')
      }
    })
    await expect(executor.transcribe(INPUT)).rejects.toThrow('whisper OOM')
    expect(calls.cleanup).toEqual(['/cache/seg1.wav'])
  })

  it('throws without transcribing when the span could not be sliced out', async () => {
    const { executor, calls } = harness({ extractSegment: async () => false })
    await expect(executor.transcribe(INPUT)).rejects.toThrow(/could not extract audio/)
    expect(calls.transcribe).toEqual([])
    expect(calls.cleanup).toEqual([]) // nothing was written, nothing to clean
  })

  it('never lets a cleanup failure mask the transcript', async () => {
    const { executor } = harness({
      cleanup: async () => {
        throw new Error('unlink failed')
      }
    })
    await expect(executor.transcribe(INPUT)).resolves.toEqual({ text: 'transcribed text' })
  })
})

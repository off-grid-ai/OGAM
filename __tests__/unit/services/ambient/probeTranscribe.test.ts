/**
 * The probe transcription runner — unlike the production pass, it must EXPOSE per-segment failure
 * reasons (a device probe's whole purpose), so this pins that it reports whisper errors, empty-text
 * outcomes, and successes distinctly, straight from the executor with no scheduler in between.
 */

import { probeTranscribeSegments } from '../../../../src/services/ambient/ambientCaptureSession'
import type { SttExecutor } from '../../../../src/services/ambient/sttExecutor'

const segs = [
  { startMs: 0, endMs: 900 },
  { startMs: 1600, endMs: 2100 }
]

describe('probeTranscribeSegments', () => {
  it('returns the transcript for a successful segment', async () => {
    const executor: SttExecutor = { transcribe: async () => ({ text: '  hello world  ' }) }
    const results = await probeTranscribeSegments([segs[0]], '/rec.wav', executor)
    expect(results).toEqual([
      { id: '0-900', startMs: 0, endMs: 900, transcript: 'hello world', error: null }
    ])
  })

  it('flags an empty transcript as a reason, not a silent blank', async () => {
    const executor: SttExecutor = { transcribe: async () => ({ text: '   ' }) }
    const [result] = await probeTranscribeSegments([segs[0]], '/rec.wav', executor)
    expect(result.transcript).toBeNull()
    expect(result.error).toMatch(/empty text/i)
  })

  it('surfaces the executor error verbatim for a failed segment', async () => {
    const executor: SttExecutor = {
      transcribe: async () => {
        throw new Error('No Whisper model loaded')
      }
    }
    const [result] = await probeTranscribeSegments([segs[0]], '/rec.wav', executor)
    expect(result.transcript).toBeNull()
    expect(result.error).toBe('No Whisper model loaded')
  })

  it('reports each segment independently — one failure does not sink the others', async () => {
    let call = 0
    const executor: SttExecutor = {
      transcribe: async () => {
        call += 1
        if (call === 1) throw new Error('could not extract audio for segment 0-900')
        return { text: 'second' }
      }
    }
    const results = await probeTranscribeSegments(segs, '/rec.wav', executor)
    expect(results.map(r => r.error)).toEqual(['could not extract audio for segment 0-900', null])
    expect(results.map(r => r.transcript)).toEqual([null, 'second'])
  })
})

/**
 * The capture->transcription join, through the real store + runner with a fake executor. Proves one
 * finished capture's segments become records with transcripts (oldest first), that a manual run is not
 * deferred by the scheduler, and that a failing executor leaves a pending record rather than a lie.
 */

import { transcribeCapturedSegments } from '../../../../src/services/ambient/ambientCaptureSession'
import type { SttExecutor } from '../../../../src/services/ambient/sttExecutor'

const echo = (text: string): SttExecutor => ({ transcribe: async () => ({ text }) })
const boom = (msg: string): SttExecutor => ({
  transcribe: async () => {
    throw new Error(msg)
  }
})

describe('transcribeCapturedSegments', () => {
  it('turns a capture into transcribed records, oldest first', async () => {
    const records = await transcribeCapturedSegments({
      segments: [
        { startMs: 1600, endMs: 2100 },
        { startMs: 0, endMs: 900 }
      ],
      recordingPath: '/rec.wav',
      executors: { phone: echo('hi') }
    })
    expect(records.map(r => r.id)).toEqual(['0-900', '1600-2100'])
    expect(records.every(r => r.transcript === 'hi')).toBe(true)
  })

  it('runs even on a low battery (a manual run defaults to healthy conditions)', async () => {
    const records = await transcribeCapturedSegments({
      segments: [{ startMs: 0, endMs: 900 }],
      recordingPath: '/rec.wav',
      executors: { phone: echo('done') }
    })
    expect(records[0].transcript).toBe('done')
  })

  it('honours explicit device conditions — a real low-battery pass defers', async () => {
    const records = await transcribeCapturedSegments({
      segments: [{ startMs: 0, endMs: 900 }],
      recordingPath: '/rec.wav',
      executors: { phone: echo('done') },
      device: { batteryLevel: 0.05, charging: false, macReachable: false }
    })
    expect(records[0].transcript).toBeNull() // deferred, still pending
  })

  it('leaves a failed segment pending with a bumped attempt, not a false transcript', async () => {
    const records = await transcribeCapturedSegments({
      segments: [{ startMs: 0, endMs: 900 }],
      recordingPath: '/rec.wav',
      executors: { phone: boom('whisper OOM') }
    })
    expect(records[0].transcript).toBeNull()
    expect(records[0].attempts).toBe(1)
  })
})

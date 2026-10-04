/**
 * Decode a 16-bit PCM WAV slice back into mono Float32 samples — the inverse of writeSegmentWav.
 *
 * The speaker-embedding model wants a raw waveform, so we read the same WAV files the STT pipeline
 * already produces and hand the model float samples in [-1, 1]. Minimal RIFF parse: find `fmt ` for
 * the sample rate and `data` for the payload; assumes mono 16-bit (what the recorder writes).
 */
import RNFS from 'react-native-fs'
import { Buffer } from 'buffer'

export interface DecodedPcm {
  samples: Float32Array
  sampleRate: number
}

/** Read a mono 16-bit WAV at `path` into Float32 samples. Throws on FS or format error. */
export async function readWavPcm(path: string): Promise<DecodedPcm> {
  const base64 = await RNFS.readFile(path, 'base64')
  const bytes = Buffer.from(base64, 'base64')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('not a RIFF/WAV file')
  }
  let sampleRate = 16000
  let dataOffset = -1
  let dataLen = 0
  // Walk the chunks after the 12-byte RIFF header.
  let p = 12
  while (p + 8 <= bytes.length) {
    const id = bytes.toString('ascii', p, p + 4)
    const size = view.getUint32(p + 4, true)
    const body = p + 8
    if (id === 'fmt ') {
      sampleRate = view.getUint32(body + 4, true)
    } else if (id === 'data') {
      dataOffset = body
      dataLen = Math.min(size, bytes.length - body)
      break
    }
    p = body + size + (size % 2) // chunks are word-aligned
  }
  if (dataOffset < 0) throw new Error('no data chunk in WAV')

  const count = Math.floor(dataLen / 2)
  const samples = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    const s = view.getInt16(dataOffset + i * 2, true)
    samples[i] = s < 0 ? s / 0x8000 : s / 0x7fff
  }
  return { samples, sampleRate }
}

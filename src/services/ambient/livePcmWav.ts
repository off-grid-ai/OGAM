/**
 * Encode one speech segment's mono Float32 PCM into a standalone 16-bit WAV file, so the live
 * transcript can transcribe it through the SAME SttExecutor the batch pipeline uses (phone or Mac).
 *
 * The header comes from @offgrid/speech's buildWavHeader (the one canonical WAV header in the repo),
 * so a live slice and a batch slice are byte-for-byte the same format whisper already reads.
 */
import RNFS from 'react-native-fs'
import { Buffer } from 'buffer'
import { buildWavHeader, WAV_HEADER_BYTES } from '@offgrid/speech'

const BYTES_PER_SAMPLE = 2

/** Write `pcm` (mono, [-1,1]) as a 16-bit PCM WAV at `path`. Returns the path. Best-effort, throws on FS error. */
export async function writeSegmentWav(
  pcm: Float32Array,
  sampleRate: number,
  path: string
): Promise<string> {
  const dataBytes = pcm.length * BYTES_PER_SAMPLE
  const header = buildWavHeader(
    { sampleRate, channels: 1, bitsPerSample: 16, dataStart: WAV_HEADER_BYTES, dataBytes },
    dataBytes
  )
  const bytes = new Uint8Array(header.length + dataBytes)
  bytes.set(header, 0)
  const view = new DataView(bytes.buffer, header.length)
  for (let i = 0; i < pcm.length; i += 1) {
    const clamped = pcm[i] < -1 ? -1 : pcm[i] > 1 ? 1 : pcm[i]
    view.setInt16(i * BYTES_PER_SAMPLE, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
  }
  await RNFS.writeFile(path, Buffer.from(bytes).toString('base64'), 'base64')
  return path
}

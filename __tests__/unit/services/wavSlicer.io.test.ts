/**
 * The WAV slice I/O — exercised against an in-memory react-native-fs so the real read/write path runs
 * byte-for-byte (no device). Proves the composition: it reads the source header, asks planWavSlice
 * where to cut, writes a fresh 44-byte header, and copies exactly the PCM for that span. The math
 * itself is proven in @offgrid/speech; this guards that the bytes actually land right.
 */


/** In-memory FS: paths -> byte buffers, with just the RNFS surface wavSlicer uses. The store lives
 * inside the factory (jest.mock cannot close over test-scope vars) and is read back via __files. */
jest.mock('react-native-fs', () => {
  const files = new Map<string, Buffer>()
  return {
    __files: files,
    stat: jest.fn(async (path: string) => ({ size: files.get(path)?.length ?? 0 })),
    read: jest.fn(async (path: string, length: number, position: number, _enc: string) => {
      const buf = files.get(path) ?? Buffer.alloc(0)
      return buf.subarray(position, position + length).toString('base64')
    }),
    writeFile: jest.fn(async (path: string, contents: string, _enc: string) => {
      files.set(path, Buffer.from(contents, 'base64'))
    }),
    write: jest.fn(async (path: string, contents: string, position: number, _enc: string) => {
      const incoming = Buffer.from(contents, 'base64')
      const existing = files.get(path) ?? Buffer.alloc(0)
      const end = position + incoming.length
      const next = Buffer.alloc(Math.max(existing.length, end))
      existing.copy(next)
      incoming.copy(next, position)
      files.set(path, next)
    }),
    unlink: jest.fn(async (path: string) => {
      files.delete(path)
    })
  }
})

import { extractWavSegment } from '../../../src/services/wavSlicer'
import { buildWavHeader, readWavFormat, WAV_HEADER_BYTES } from '@offgrid/speech'
import RNFS from 'react-native-fs'

const files = (RNFS as unknown as { __files: Map<string, Buffer> }).__files

const RATE = 16000
const FRAME = 2 // mono int16

/** A 16 kHz mono int16 WAV where each frame's bytes encode its index, so a slice is checkable. */
function makeWav(seconds: number): Buffer {
  const dataBytes = Math.round(seconds * RATE) * FRAME
  const format = {
    sampleRate: RATE,
    channels: 1,
    bitsPerSample: 16,
    dataStart: WAV_HEADER_BYTES,
    dataBytes
  }
  const header = Buffer.from(buildWavHeader(format, dataBytes))
  const pcm = Buffer.alloc(dataBytes)
  for (let i = 0; i < dataBytes / FRAME; i += 1) pcm.writeUInt16LE(i & 0xffff, i * FRAME)
  return Buffer.concat([header, pcm])
}

describe('extractWavSegment', () => {
  beforeEach(() => files.clear())

  it('writes a standalone WAV holding exactly the requested span', async () => {
    files.set('/src.wav', makeWav(3))
    const ok = await extractWavSegment('/src.wav', 1000, 2000, '/out.wav')
    expect(ok).toBe(true)

    const out = files.get('/out.wav')!
    const fmt = readWavFormat(new Uint8Array(out))!
    // 1s..2s of 16k mono int16 = 16000 frames = 32000 bytes of PCM behind a 44-byte header.
    expect(fmt.dataBytes).toBe(32000)
    expect(out.length).toBe(WAV_HEADER_BYTES + 32000)

    // Byte-exact: the first kept frame is index 16000 (one second in), then it counts up.
    const firstFrame = out.readUInt16LE(WAV_HEADER_BYTES)
    const secondFrame = out.readUInt16LE(WAV_HEADER_BYTES + FRAME)
    expect(firstFrame).toBe(16000)
    expect(secondFrame).toBe(16001)
  })

  it('clamps a span past the real end and still writes valid audio', async () => {
    files.set('/src.wav', makeWav(1))
    const ok = await extractWavSegment('/src.wav', 500, 5000, '/out.wav')
    expect(ok).toBe(true)
    const out = files.get('/out.wav')!
    expect(readWavFormat(new Uint8Array(out))!.dataBytes).toBe(16000) // 0.5s..1.0s only
  })

  it('returns false and writes nothing when the span lands on no audio', async () => {
    files.set('/src.wav', makeWav(1))
    const ok = await extractWavSegment('/src.wav', 2000, 3000, '/out.wav')
    expect(ok).toBe(false)
    expect(files.has('/out.wav')).toBe(false)
  })

  it('returns false on an unreadable source header', async () => {
    files.set('/src.wav', Buffer.alloc(64))
    const ok = await extractWavSegment('/src.wav', 0, 1000, '/out.wav')
    expect(ok).toBe(false)
  })
})

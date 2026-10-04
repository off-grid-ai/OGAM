import RNFS from 'react-native-fs'
import { Buffer } from 'buffer'
import { WAV_HEADER_BYTES, WAV_HEADER_SCAN_BYTES, planWavSlice } from '@offgrid/speech'
import logger from '../utils/logger'

/**
 * Carve one detected speech span out of the rolling capture file into its own standalone WAV.
 *
 * The 24/7 recorder keeps a long rolling recording; VAD marks the [startMs, endMs) spans where
 * someone actually spoke, and each span is transcribed separately. Whisper needs a real WAV file for
 * exactly that window - a fresh canonical header in front of just those PCM bytes - so this reads the
 * source header, asks the shared planner WHERE to cut, and copies the range out.
 *
 * This is the I/O half only. WHERE to cut is `planWavSlice` in `@offgrid/speech` - pure, shared with
 * desktop, tested on real WAV bytes. This file reads and writes; it decides nothing.
 *
 * Failure is always non-fatal: on any problem it removes the partial output and returns false, so the
 * source recording is never touched and the caller skips that segment instead of transcribing noise.
 */

/**
 * Bytes per copied chunk. A multiple of 3 so each chunk's base64 has no interior padding (concatenated
 * at byte offsets a padded chunk would shift everything after it), and even so a 16-bit frame is never
 * split. Same constant as the trimmer, same reason.
 */
const COPY_CHUNK_BYTES = 3 * 256 * 1024

export async function extractWavSegment(
  sourcePath: string,
  startMs: number,
  endMs: number,
  outPath: string
): Promise<boolean> {
  try {
    const info = await RNFS.stat(sourcePath)
    const fileBytes = Number(info.size)
    const head = new Uint8Array(
      Buffer.from(await RNFS.read(sourcePath, WAV_HEADER_SCAN_BYTES, 0, 'base64'), 'base64')
    )

    const plan = planWavSlice(head, startMs / 1000, endMs / 1000, fileBytes)
    if (!plan) {
      logger.log(
        `[ambient] slice skipped (nothing to cut for ${startMs}-${endMs}ms in ${fileBytes}B)`
      )
      return false
    }

    await RNFS.writeFile(outPath, Buffer.from(plan.header).toString('base64'), 'base64')

    let copied = 0
    while (copied < plan.copyBytes) {
      const length = Math.min(COPY_CHUNK_BYTES, plan.copyBytes - copied)
      const chunk = await RNFS.read(sourcePath, length, plan.copyFrom + copied, 'base64')
      await RNFS.write(outPath, chunk, WAV_HEADER_BYTES + copied, 'base64')
      copied += length
    }
    return true
  } catch (error) {
    await RNFS.unlink(outPath).catch(() => undefined)
    logger.warn('[ambient] wav slice failed, leaving the source recording untouched', error)
    return false
  }
}

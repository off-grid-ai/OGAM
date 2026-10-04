/**
 * Wires replay clip preparation to the real WAV slicer + a Caches scratch dir (throwaway clips).
 */

import RNFS from 'react-native-fs'
import { extractWavSegment } from '../wavSlicer'
import { prepareReplayClip, type ReplaySource } from './replayClip'

const REPLAY_DIR = `${RNFS.CachesDirectoryPath}/ambient-replay`

export async function ensureReplayDir(): Promise<void> {
  if (!(await RNFS.exists(REPLAY_DIR))) await RNFS.mkdir(REPLAY_DIR)
}

export function prepareReplayClipForSource(source: ReplaySource): Promise<string | null> {
  return prepareReplayClip(source, {
    extractSegment: extractWavSegment,
    outPath: key => `${REPLAY_DIR}/${key}.wav`
  })
}

/**
 * Wires the on-device whisper SttExecutor to release's speech port. The port's transcriber routes to
 * on-device whisper OR a remote/Mac transcription target on its own, so the ambient recorder gets
 * remote STT for free. We slice the segment's span into a standalone WAV, hand the file to the port,
 * and delete the slice.
 */

import RNFS from 'react-native-fs'
import { extractWavSegment } from '../wavSlicer'
import { mobileSpeechInputPorts } from '../adapters/speech/mobileSpeechInputPorts'
import { useWhisperStore } from '../../stores/whisperStore'
import { createPhoneSttExecutor } from './phoneSttExecutor'
import type { SttExecutor } from './sttExecutor'

const SLICE_DIR = `${RNFS.CachesDirectoryPath}/ambient-slices`

export function createDefaultPhoneSttExecutor(language?: string): SttExecutor {
  return createPhoneSttExecutor({
    extractSegment: extractWavSegment,
    transcribe: async (filePath, options) => {
      const result = await mobileSpeechInputPorts.transcriber.transcribe(
        { kind: 'file', path: filePath },
        {
          language: options?.language ?? useWhisperStore.getState().transcriptionLanguage ?? 'en',
          extension: 'wav',
          signal: new AbortController().signal
        }
      )
      return result.text
    },
    tempPath: segmentId => `${SLICE_DIR}/${segmentId}.wav`,
    cleanup: async path => {
      await RNFS.unlink(path)
    },
    language
  })
}

/** Best-effort: make sure the slice scratch dir exists before the first segment is cut. */
export async function ensureAmbientSliceDir(): Promise<void> {
  const exists = await RNFS.exists(SLICE_DIR)
  if (!exists) await RNFS.mkdir(SLICE_DIR)
}

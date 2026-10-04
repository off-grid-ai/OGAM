/**
 * Mac-offload SttExecutor: slice the segment to a WAV (same as the phone leg) but transcribe it on the
 * paired Mac over the LAN gateway instead of on-device. Reuses the phone executor's slice/cleanup core
 * (createPhoneSttExecutor) - only the transcribe step differs. Throws on any failure so dispatchStt
 * falls back to on-device whisper; the Mac is an accelerator, never a hard dependency.
 */

import RNFS from 'react-native-fs'
import { extractWavSegment } from '../wavSlicer'
import { createPhoneSttExecutor } from './phoneSttExecutor'
import { currentMacOffloadTarget, transcriptionEndpoint } from './macTranscriptionTarget'
import type { SttExecutor } from './sttExecutor'

const SLICE_DIR = `${RNFS.CachesDirectoryPath}/ambient-slices`

/** True when a paired Mac is granted + reachable to take transcription work. */
export function macOffloadReady(): boolean {
  return currentMacOffloadTarget() !== null
}

async function transcribeOnMac(filePath: string, language?: string): Promise<string> {
  const target = currentMacOffloadTarget()
  if (!target) {
    throw new Error('ambient: no Mac available for transcription offload')
  }
  const body = new FormData()
  body.append('file', {
    uri: filePath.startsWith('file://') ? filePath : `file://${filePath}`,
    name: 'segment.wav',
    type: 'audio/wav'
  } as unknown as Blob)
  body.append('response_format', 'json')
  if (language) {
    body.append('language', language)
  }
  const response = await fetch(transcriptionEndpoint(target.baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${target.token}` },
    body
  })
  if (!response.ok) {
    throw new Error(`ambient: Mac transcription failed (HTTP ${response.status})`)
  }
  const payload = (await response.json()) as { text?: unknown }
  if (typeof payload.text !== 'string') {
    throw new Error('ambient: Mac returned no transcript')
  }
  return payload.text
}

export function createDefaultMacSttExecutor(language?: string): SttExecutor {
  return createPhoneSttExecutor({
    extractSegment: extractWavSegment,
    transcribe: (filePath, options) => transcribeOnMac(filePath, options?.language ?? language),
    tempPath: segmentId => `${SLICE_DIR}/mac-${segmentId}.wav`,
    cleanup: async path => {
      await RNFS.unlink(path)
    },
    language
  })
}

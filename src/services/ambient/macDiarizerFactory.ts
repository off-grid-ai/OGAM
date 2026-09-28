/**
 * Mac-offload diarizer — POST a recording to the paired Mac's gateway, which runs pyannote segmentation
 * + the phone-selected fingerprint model and returns speaker turns (each with a voiceprint). The phone
 * is the single source of truth for which fingerprint to use, sent as `embeddingModel`, so the Mac's
 * turns share the phone's vector space. Works for BOTH iPhone and Android. Throws when no Mac is
 * reachable → dispatchDiarize falls back to on-device.
 */
import RNFS from 'react-native-fs'
import type { DiarizationModel } from '@offgrid/models'
import { currentMacOffloadTarget, diarizeEndpoint } from './macTranscriptionTarget'
import { normalize } from './speakerModel'
import type { Diarizer, DiarizationResult } from './speakerDiarizer'

interface MacTurn {
  startMs: number
  endMs: number
  cluster: string
  embedding?: number[]
}

/** A diarizer backed by the paired Mac running `model`'s fingerprint, or null when no Mac is reachable. */
export function createMacDiarizer(model: DiarizationModel): Diarizer | null {
  if (!currentMacOffloadTarget()) return null
  return {
    diarize: async (recordingPath: string): Promise<DiarizationResult> => {
      const target = currentMacOffloadTarget()
      if (!target) throw new Error('ambient: no Mac available for diarization offload')
      // A pending recording's file can be gone (pruned by retention, cleared, or never finished). Uploading
      // a missing file makes React Native's multipart builder throw a native, uncaught error that crashes
      // the app — so fail here with a normal Error the caller can catch and fall back / drop the capture.
      const localPath = recordingPath.replace(/^file:\/\//, '')
      if (!(await RNFS.exists(localPath))) {
        throw new Error(`ambient: recording file is missing, cannot offload diarization (${localPath})`)
      }
      const body = new FormData()
      body.append('file', {
        uri: recordingPath.startsWith('file://') ? recordingPath : `file://${recordingPath}`,
        name: 'recording.wav',
        type: 'audio/wav'
      } as unknown as Blob)
      body.append('embeddingModel', model.id)
      const res = await fetch(diarizeEndpoint(target.baseUrl), {
        method: 'POST',
        headers: { Authorization: `Bearer ${target.token}` },
        body
      })
      if (!res.ok) throw new Error(`ambient: Mac diarization failed (HTTP ${res.status})`)
      const payload = (await res.json()) as { turns?: MacTurn[] }
      const turns = (payload.turns ?? []).map(t => ({
        startMs: t.startMs,
        endMs: t.endMs,
        cluster: t.cluster,
        embedding: t.embedding && t.embedding.length > 0 ? normalize(t.embedding) : undefined
      }))
      return { turns }
    }
  }
}

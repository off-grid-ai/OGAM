/**
 * Mac-offload diarizer — POST a recording to the paired Mac's gateway, which runs pyannote + ECAPA and
 * returns speaker turns (each with a voiceprint). Reuses the same companion token as STT offload; works
 * for BOTH iPhone and Android (the phone just calls the Mac). Cross-platform diarization today, while
 * the on-device sherpa engine is the offline follow-up. Throws when no Mac is reachable → fallback.
 */
import { currentMacOffloadTarget, diarizeEndpoint } from './macTranscriptionTarget'
import { normalize } from './speakerModel'
import type { Diarizer, DiarizationResult } from './speakerDiarizer'

interface MacTurn {
  startMs: number
  endMs: number
  cluster: string
  embedding?: number[]
}

/** A diarizer backed by the paired Mac, or null when no Mac is granted/reachable. */
export function createMacDiarizer(): Diarizer | null {
  if (!currentMacOffloadTarget()) return null
  return {
    diarize: async (recordingPath: string): Promise<DiarizationResult> => {
      const target = currentMacOffloadTarget()
      if (!target) throw new Error('ambient: no Mac available for diarization offload')
      const body = new FormData()
      body.append('file', {
        uri: recordingPath.startsWith('file://') ? recordingPath : `file://${recordingPath}`,
        name: 'recording.wav',
        type: 'audio/wav'
      } as unknown as Blob)
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

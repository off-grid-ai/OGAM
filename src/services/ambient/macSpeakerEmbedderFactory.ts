/**
 * Mac-offload speaker embedder — posts a WAV clip to the paired Mac's /v1/audio/embed. The phone picks
 * the voice fingerprint model (the single source of truth); we tell the Mac which one to run via
 * `embeddingModel`, so the Mac's voiceprints land in the SAME space the phone enrolls in — on-device
 * and Mac share one vector space per fingerprint. Reuses the companion token like STT/diarize offload.
 */
import RNFS from 'react-native-fs'
import type { DiarizationModel } from '@offgrid/models'
import { currentMacOffloadTarget, embedEndpoint } from './macTranscriptionTarget'
import { normalize, type SpeakerEmbedding } from './speakerModel'
import type { SpeakerEmbedder, SpeakerEmbedInput } from './speakerEmbedder'

async function embedOnMac(filePath: string, embeddingModel: string): Promise<SpeakerEmbedding> {
  const target = currentMacOffloadTarget()
  if (!target) throw new Error('ambient: no Mac available for embedding offload')
  const base64 = await RNFS.readFile(filePath, 'base64')
  const res = await fetch(embedEndpoint(target.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.token}` },
    body: JSON.stringify({ audio: base64, format: 'wav', embeddingModel })
  })
  if (!res.ok) throw new Error(`ambient: Mac embed failed (HTTP ${res.status})`)
  const json = (await res.json()) as { embedding?: number[] }
  if (!json.embedding || json.embedding.length === 0) throw new Error('ambient: Mac returned no voiceprint')
  return normalize(json.embedding)
}

/** A Mac-offload embedder for the selected fingerprint, or null when no Mac is reachable. */
export function createMacSpeakerEmbedder(model: DiarizationModel): SpeakerEmbedder | null {
  if (!currentMacOffloadTarget()) return null
  return { dim: model.embeddingDim, embed: (input: SpeakerEmbedInput) => embedOnMac(input.slicePath, model.id) }
}

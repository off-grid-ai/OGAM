/**
 * Mac-offload speaker embedder — posts a WAV clip to the paired Mac's /v1/audio/embed, which runs the
 * SAME ECAPA model the diarizer uses, so enrolled voiceprints live in the diarizer's vector space
 * (the alignment identity naming needs). Reuses the companion token like STT/diarize offload.
 */
import RNFS from 'react-native-fs'
import { currentMacOffloadTarget, embedEndpoint } from './macTranscriptionTarget'
import { normalize, type SpeakerEmbedding } from './speakerModel'
import type { SpeakerEmbedder, SpeakerEmbedInput } from './speakerEmbedder'

/** Profiles enrolled through the Mac ECAPA live under this id — same space as the Mac diarized turns. */
export const MAC_EMBED_MODEL_ID = 'mac-ecapa-voxceleb'
export const MAC_EMBED_DIM = 192

async function embedOnMac(filePath: string): Promise<SpeakerEmbedding> {
  const target = currentMacOffloadTarget()
  if (!target) throw new Error('ambient: no Mac available for embedding offload')
  const base64 = await RNFS.readFile(filePath, 'base64')
  const res = await fetch(embedEndpoint(target.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${target.token}` },
    body: JSON.stringify({ audio: base64, format: 'wav' })
  })
  if (!res.ok) throw new Error(`ambient: Mac embed failed (HTTP ${res.status})`)
  const json = (await res.json()) as { embedding?: number[] }
  if (!json.embedding || json.embedding.length === 0) throw new Error('ambient: Mac returned no voiceprint')
  return normalize(json.embedding)
}

/** A Mac-offload embedder, or null when no Mac is reachable. */
export function createMacSpeakerEmbedder(): SpeakerEmbedder | null {
  if (!currentMacOffloadTarget()) return null
  return { dim: MAC_EMBED_DIM, embed: (input: SpeakerEmbedInput) => embedOnMac(input.slicePath) }
}

/**
 * Mac-offload speaker embedder — posts a slice + the selected model id to the desktop gateway, which
 * runs the SAME embedding model in Python and returns the vector. Mirrors macSttExecutorFactory: the
 * Mac is an accelerator over the mesh, never a hard dependency (dispatchSpeakerEmbed falls back).
 */
import RNFS from 'react-native-fs'
import type { SpeakerEmbeddingCatalogModel } from '@offgrid/models'
import { normalize, type SpeakerEmbedding } from './speakerModel'
import type { SpeakerEmbedder, SpeakerEmbedInput } from './speakerEmbedder'

const EMBED_PATH = '/v1/audio/embed'

async function embedOnMac(
  baseUrl: string,
  modelId: string,
  filePath: string
): Promise<SpeakerEmbedding> {
  const base64 = await RNFS.readFile(filePath, 'base64')
  const res = await fetch(`${baseUrl}${EMBED_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: base64, format: 'wav', model: modelId })
  })
  if (!res.ok) throw new Error(`mac embed failed: ${res.status}`)
  const json = (await res.json()) as { embedding?: number[] }
  if (!json.embedding || json.embedding.length === 0) throw new Error('mac embed returned no vector')
  return normalize(json.embedding)
}

/** Build a Mac-offload embedder for a catalog model against a reachable gateway base URL. */
export function createMacSpeakerEmbedder(
  model: SpeakerEmbeddingCatalogModel,
  baseUrl: string
): SpeakerEmbedder {
  return {
    dim: model.dim,
    embed: (input: SpeakerEmbedInput) => embedOnMac(baseUrl, model.id, input.slicePath)
  }
}

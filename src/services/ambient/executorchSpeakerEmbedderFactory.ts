/**
 * On-device speaker embedder via ExecuTorch — parameterized by the selected catalog model.
 *
 * The catalog (SPEAKER_EMBEDDING_MODELS) makes the model swappable: each entry carries its embedding
 * dim and artifact URL. The .pte (exported by scripts/export_ecapa_executorch.py) takes a raw mono
 * 16 kHz waveform [1, N] and emits a [1, dim] vector — the mel front-end is baked into the graph, so
 * the phone side just hands over float samples. Zero network. Throws when the model isn't loaded so
 * dispatchSpeakerEmbed can fall back to the Mac.
 */
import { ExecutorchModule, ScalarType } from 'react-native-executorch'
import type { SpeakerEmbeddingCatalogModel } from '@offgrid/models'
import { readWavPcm } from './wavDecode'
import { normalize, type SpeakerEmbedding } from './speakerModel'
import type { SpeakerEmbedder, SpeakerEmbedInput } from './speakerEmbedder'

/**
 * Build an on-device embedder for a catalog model. `modelSource` is the loadable artifact — a bundled
 * asset path or the local file the downloader wrote (defaults to the catalog URL).
 */
export function createExecutorchSpeakerEmbedder(
  model: SpeakerEmbeddingCatalogModel,
  modelSource: string = model.url
): SpeakerEmbedder {
  const module = new ExecutorchModule()
  let loaded: Promise<void> | null = null
  const ensureLoaded = (): Promise<void> => {
    if (!loaded) loaded = module.load(modelSource)
    return loaded
  }

  return {
    dim: model.dim,
    async embed(input: SpeakerEmbedInput): Promise<SpeakerEmbedding> {
      await ensureLoaded()
      const { samples } = await readWavPcm(input.slicePath)
      if (samples.length === 0) throw new Error('empty audio slice')
      const output = await module.forward([
        { dataPtr: samples, sizes: [1, samples.length], scalarType: ScalarType.FLOAT }
      ])
      const vec = output[0]?.dataPtr as Float32Array | undefined
      if (!vec || vec.length === 0) throw new Error('embedder returned no vector')
      return normalize(Array.from(vec))
    }
  }
}

import type { ModelFile } from '../../types';

/**
 * The one chat model that ships with the app: LFM3-VL-2B, vision, reasoning and tools at 1.48 GB.
 *
 * Play delivers it as two fast-follow AI packs (android/chat_model, android/chat_mmproj); the weights and
 * the projector together sit too close to Play's 1.5 GB per-pack cap for one. The rows below are the
 * catalog's (catalog/models.json); a test holds them equal, and the Android build fetches the files from
 * that same row.
 */
export const BUNDLED_MODEL = {
  modelId: 'LiquidAI/LFM3-VL-2B-GGUF',
  weights: {
    pack: 'chat_model',
    name: 'LFM3-VL-2B-Q4_K_M.gguf',
    sizeBytes: 1099627808,
    url: 'https://huggingface.co/LiquidAI/LFM3-VL-2B-GGUF/resolve/b36554cfd35854b06429900131730cd80f092cdb/LFM3-VL-2B-Q4_K_M.gguf',
    sha256: '56dac2e192ff0d9ab8507f4f1aeb4aed0463449bbbefaac79497f041c95f21eb',
  },
  mmproj: {
    pack: 'chat_mmproj',
    name: 'mmproj-LFM3-VL-2B-F16.gguf',
    sizeBytes: 378996032,
    url: 'https://huggingface.co/LiquidAI/LFM3-VL-2B-GGUF/resolve/b36554cfd35854b06429900131730cd80f092cdb/mmproj-LFM3-VL-2B-F16.gguf',
    sha256: '1d8e6e58eefc093e09d6332f081516e1ddbd5b35cfca7f35463fb270db230b1e',
  },
  quantization: 'Q4_K_M',
} as const;

export const BUNDLED_PACKS = [BUNDLED_MODEL.weights.pack, BUNDLED_MODEL.mmproj.pack] as const;

/** The bundled model as a download request, so the regular downloader can fetch it when no pack comes. */
export function bundledModelFile(): ModelFile {
  const { weights, mmproj, quantization } = BUNDLED_MODEL;
  return {
    name: weights.name,
    size: weights.sizeBytes,
    quantization,
    downloadUrl: weights.url,
    sha256: weights.sha256,
    mmProjFile: { name: mmproj.name, size: mmproj.sizeBytes, downloadUrl: mmproj.url, sha256: mmproj.sha256 },
  };
}

// EmbedPort for the phone: the built-in MiniLM-L6 model on llama.rn (the same family desktop
// indexes documents with), or the embedding model the person chose instead. Vectors are normalised so the shared ranking can
// compare them by dot product. The phone has no reranker; keyword + vector ranking answers.

import type { EmbedPort } from '@offgrid/rag/documents';
import { embeddingService } from '../rag/embedding';

function normalise(vector: number[]): number[] {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return vector.map((value) => value / norm);
}

async function ready(): Promise<void> {
  if (!embeddingService.isLoaded()) await embeddingService.load();
}

export const documentEmbedder: EmbedPort = {
  get embedder() {
    return embeddingService.getModelId();
  },
  async embedPassages(texts) {
    await ready();
    return (await embeddingService.embedBatch(texts)).map(normalise);
  },
  async embedQuery(text) {
    await ready();
    return normalise(await embeddingService.embed(text));
  },
};

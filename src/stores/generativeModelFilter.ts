const NON_GENERATIVE_PATTERNS = [
  'embed',
  'embedding',
  'rerank',
  'reranker',
  'classifier',
  'bge-',
  'e5-',
  'gte-',
  'minilm',
  'arctic-embed',
];

/** Returns true for models that generate text/images. */
export function isGenerativeModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return !NON_GENERATIVE_PATTERNS.some(pattern => id.includes(pattern));
}
